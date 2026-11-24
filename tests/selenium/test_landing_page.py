import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class TestLandingPage:
    """E2E Selenium Tests for DevSentry Landing Page and Navigation."""

    def test_landing_page_title_and_branding(self, driver, base_url):
        """Verify page title, brand header, and tagline."""
        driver.get(base_url)
        
        # Verify page title
        assert "DevSentry" in driver.title or "devsentry" in driver.title.lower() or "Vite" in driver.title
        
        # Verify brand mark / logo contains 'dev' and 'sentry'
        brand_elem = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".landing-nav .brand"))
        )
        brand_clean = brand_elem.text.lower().replace("\n", "").replace(" ", "")
        assert "devsentry" in brand_clean

    def test_hero_section_content(self, driver, base_url):
        """Verify hero heading, subtitle, and trust badge."""
        driver.get(base_url)
        
        # Hero heading
        h1_elem = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".hero h1"))
        )
        assert "Know where your code" in h1_elem.text
        assert "most likely to break" in h1_elem.text

        # Eyebrow tag
        eyebrow = driver.find_element(By.CSS_SELECTOR, ".hero .eyebrow")
        assert "SOFTWARE HEALTH" in eyebrow.text

        # Security note
        note = driver.find_element(By.CSS_SELECTOR, ".hero-note")
        assert "Read-only analysis" in note.text
        assert "Your code is never executed" in note.text

    def test_call_to_action_buttons(self, driver, base_url):
        """Verify sign-in CTA links point to OAuth entry point."""
        driver.get(base_url)
        
        # Navbar sign-in button
        nav_signin = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".landing-nav a.button-quiet"))
        )
        assert "/auth/google" in nav_signin.get_attribute("href")
        
        # Hero primary CTA button
        hero_cta = driver.find_element(By.CSS_SELECTOR, ".hero a.hero-cta")
        assert "Sign in with Google" in hero_cta.text
        assert "/auth/google" in hero_cta.get_attribute("href")

    def test_features_section_displayed(self, driver, base_url):
        """Verify the 3 core platform pillars are listed."""
        driver.get(base_url)
        
        features = WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".landing-features > div"))
        )
        assert len(features) == 3
        
        feature_text = " ".join([f.text for f in features])
        assert "01 / SIGNAL" in feature_text
        assert "Understand risk" in feature_text
        assert "02 / FOCUS" in feature_text
        assert "Find what matters" in feature_text
        assert "03 / IMPROVE" in feature_text
        assert "Track progress" in feature_text

    def test_preview_card_and_risk_metrics(self, driver, base_url):
        """Verify preview dashboard card with sample risk score."""
        driver.get(base_url)
        
        preview_card = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".preview-card"))
        )
        assert "LIVE VIEW" in preview_card.text
        assert "OVERALL RISK" in preview_card.text
        assert "LOW RISK" in preview_card.text
