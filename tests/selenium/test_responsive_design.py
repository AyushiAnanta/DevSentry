import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class TestResponsiveDesign:
    """E2E Selenium Tests for Viewport Responsiveness across Devices."""

    @pytest.mark.parametrize("width,height,device_name", [
        (1920, 1080, "Desktop FHD"),
        (1366, 768, "Standard Laptop"),
        (768, 1024, "Tablet Portrait"),
        (375, 812, "Mobile Device"),
    ])
    def test_responsive_layout_rendering(self, driver, base_url, width, height, device_name):
        """Verify layout renders without breaking across resolutions."""
        driver.set_window_size(width, height)
        driver.get(base_url)
        
        # Verify body is displayed and readable
        body = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        assert body.is_displayed()
        
        # Verify brand mark remains visible
        brand = driver.find_element(By.CSS_SELECTOR, ".landing-nav .brand")
        assert brand.is_displayed()
        
        # Check no horizontal scrolling overflow in mobile viewports
        scroll_width = driver.execute_script("return document.documentElement.scrollWidth")
        client_width = driver.execute_script("return document.documentElement.clientWidth")
        # Allow small margin for scrollbars
        assert scroll_width <= client_width + 25, f"Horizontal overflow detected on {device_name}"
