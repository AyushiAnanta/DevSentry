pipeline {
    agent any

    environment {
        NODE_ENV = 'test'
        CI = 'true'
        // Email recipient list for test failure alerts
        TEAM_EMAIL = 'aditi.jangra2005@gmail.com'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                script {
                    if (isUnix()) {
                        sh '''
                            npm --prefix server install
                            npm --prefix client install
                            python3 -m venv venv || virtualenv venv
                            . venv/bin/activate
                            pip install -r tests/selenium/requirements.txt
                        '''
                    } else {
                        bat '''
                            call npm.cmd --prefix server install --no-audit --no-fund
                            call npm.cmd --prefix client install --no-audit --no-fund
                            if not exist venv (
                                python -m venv venv
                            )
                            call .\\venv\\Scripts\\python.exe -m pip install --upgrade pip
                            call .\\venv\\Scripts\\python.exe -m pip install -r tests\\selenium\\requirements.txt
                        '''
                    }
                }
            }
        }

        stage('Lint & Typecheck') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'npm --prefix server run typecheck'
                        sh 'npm --prefix client run typecheck'
                    } else {
                        bat 'call npm.cmd --prefix server run typecheck'
                        bat 'call npm.cmd --prefix client run typecheck'
                    }
                }
            }
        }

        stage('Unit Tests') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'npm --prefix client test'
                    } else {
                        bat 'call npm.cmd --prefix client test'
                    }
                }
            }
        }

        stage('Client Build') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'npm --prefix client run build'
                    } else {
                        bat 'call npm.cmd --prefix client run build'
                    }
                }
            }
        }

        stage('Selenium E2E Tests') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'python tests/selenium/run_selenium.py --junitxml=reports/selenium-results.xml'
                    } else {
                        bat 'call .\\venv\\Scripts\\python.exe tests/selenium/run_selenium.py --junitxml=reports/selenium-results.xml'
                    }
                }
            }
        }
    }

    post {
        always {
            // Publish JUnit XML test results for test trend charts in Jenkins
            junit testResults: 'reports/**/*.xml', allowEmptyResults: true

            // Archive failure screenshots if any tests failed
            archiveArtifacts artifacts: 'tests/selenium/screenshots/**/*.png', allowEmptyArchive: true
        }

        failure {
            // Fired automatically when ANY test (unit or Selenium) fails in the pipeline
            echo "Pipeline FAILED! Sending alert email to team..."
            mail to: "${env.TEAM_EMAIL}",
                 subject: "🚨 [DevSentry CI Alert] Build #${env.BUILD_NUMBER} FAILED - Tests Failed",
                 body: """Hello Team,

A build failure occurred in the DevSentry CI/CD pipeline.

- Job: ${env.JOB_NAME}
- Build Number: #${env.BUILD_NUMBER}
- Build Status: FAILED
- Commit: ${env.GIT_COMMIT}
- Triggered Branch: ${env.GIT_BRANCH}
- Jenkins Console Log: ${env.BUILD_URL}console

Please inspect the failed unit or Selenium E2E test logs and screenshots attached in Jenkins.

Regards,
DevSentry Automation Bot
"""
        }

        fixed {
            echo "Pipeline recovered! Sending recovery email..."
            mail to: "${env.TEAM_EMAIL}",
                 subject: "✅ [DevSentry CI] Build #${env.BUILD_NUMBER} FIXED - All Tests Passed",
                 body: """Great news! The pipeline has recovered. All unit tests and Selenium E2E tests are passing.

- Job: ${env.JOB_NAME}
- Build Number: #${env.BUILD_NUMBER}
- Status: SUCCESS
- Build URL: ${env.BUILD_URL}
"""
        }
    }
}
