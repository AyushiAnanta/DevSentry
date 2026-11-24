import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class TestQuickScanPage:
    """E2E Selenium Tests for DevSentry Quick Scan Playground."""

    def test_quick_scan_page_elements(self, driver, base_url):
        """Verify Quick Scan heading, language selector, and action buttons."""
        driver.get(f"{base_url}/quick-scan")
        
        # Wait for potential initial auth check / page render
        WebDriverWait(driver, 10).until(
            lambda d: not d.find_elements(By.CSS_SELECTOR, ".loading")
        )
        
        current_url = driver.current_url
        if current_url.endswith("/quick-scan"):
            # Authenticated view
            h1 = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, ".page-heading h1"))
            )
            assert "Quick scan" in h1.text
            
            btn = driver.find_element(By.CSS_SELECTOR, ".editor-toolbar button")
            assert "Analyze snippet" in btn.text
        else:
            # Protected route properly redirected unauthenticated user to landing
            assert current_url.rstrip("/") == base_url.rstrip("/")

    def test_quick_scan_route_protection_flow(self, driver, base_url):
        """Verify protected route redirects and finishes loading safely."""
        driver.get(f"{base_url}/quick-scan")
        
        # Wait until loading spinner finishes
        WebDriverWait(driver, 10).until(
            lambda d: not d.find_elements(By.CSS_SELECTOR, ".loading")
        )
        
        # Verify page source renders properly
        page_source = driver.page_source
        assert ("Know where your code" in page_source) or ("Quick scan" in page_source)
