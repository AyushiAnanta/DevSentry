import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class TestAuthAndResetPages:
    """E2E Selenium tests for Email/Password auth and Forgot/Reset Password flows."""

    def test_landing_shows_email_auth_links(self, driver, base_url):
        driver.get(base_url)

        login_link = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".hero-alt-links a[href='/login']"))
        )
        register_link = driver.find_element(By.CSS_SELECTOR, ".hero-alt-links a[href='/register']")
        assert "Sign in with email" in login_link.text
        assert "Create account" in register_link.text

    def test_login_page_validation_and_forgot_link(self, driver, base_url):
        driver.get(f"{base_url}/login")

        heading = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".auth-card h1"))
        )
        assert "Sign in to DevSentry" in heading.text

        driver.find_element(By.CSS_SELECTOR, "button.auth-submit").click()
        error_box = WebDriverWait(driver, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "[role='alert']"))
        )
        assert "Enter your email and password" in error_box.text

        forgot_link = driver.find_element(By.CSS_SELECTOR, "a[href='/forgot-password']")
        assert "Forgot password?" in forgot_link.text

    def test_register_page_password_mismatch_validation(self, driver, base_url):
        driver.get(f"{base_url}/register")

        WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".auth-card h1"))
        )
        inputs = driver.find_elements(By.CSS_SELECTOR, ".auth-form input")
        inputs[0].send_keys("Test User")
        inputs[1].send_keys("test@example.com")
        inputs[2].send_keys("Password123!")
        inputs[3].send_keys("Different123!")
        driver.find_element(By.CSS_SELECTOR, "button.auth-submit").click()

        error_box = WebDriverWait(driver, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "[role='alert']"))
        )
        assert "Passwords do not match" in error_box.text

    def test_forgot_password_page_validation(self, driver, base_url):
        driver.get(f"{base_url}/forgot-password")

        heading = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".auth-card h1"))
        )
        assert "Forgot your password?" in heading.text

        driver.find_element(By.CSS_SELECTOR, ".auth-form input[type='email']").send_keys("bad-email")
        driver.find_element(By.CSS_SELECTOR, "button.auth-submit").click()

        error_box = WebDriverWait(driver, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "[role='alert']"))
        )
        assert "valid email" in error_box.text

    def test_reset_password_page_token_states(self, driver, base_url):
        driver.get(f"{base_url}/reset-password")
        missing_alert = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "[role='alert']"))
        )
        assert "missing a token" in missing_alert.text

        driver.get(f"{base_url}/reset-password?token=sample-reset-token-123456")
        inputs = WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".auth-form input[type='password']"))
        )
        assert len(inputs) == 2
        inputs[0].send_keys("NewPass123!")
        inputs[1].send_keys("Mismatch123!")
        driver.find_element(By.CSS_SELECTOR, "button.auth-submit").click()

        mismatch_alert = WebDriverWait(driver, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "[role='alert']"))
        )
        assert "Passwords do not match" in mismatch_alert.text
