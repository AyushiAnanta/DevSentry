import os
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.edge.options import Options as EdgeOptions

def pytest_addoption(parser):
    parser.addoption(
        "--browser",
        action="store",
        default="chrome",
        help="Browser to run tests with: chrome or edge",
    )
    parser.addoption(
        "--headed",
        action="store_true",
        default=False,
        help="Run browser in visible (headed) mode instead of headless",
    )
    parser.addoption(
        "--base-url",
        action="store",
        default="http://localhost:5173",
        help="Base URL of the DevSentry frontend web application",
    )

@pytest.fixture(scope="session")
def base_url(request):
    return request.config.getoption("--base-url").rstrip("/")

@pytest.fixture(scope="function")
def driver(request):
    browser = request.config.getoption("--browser").lower()
    headed = request.config.getoption("--headed")
    
    if browser == "edge":
        options = EdgeOptions()
        if not headed:
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1280,800")
        driver_instance = webdriver.Edge(options=options)
    else:
        options = ChromeOptions()
        if not headed:
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1280,800")
        # Ensure smooth headless rendering
        options.add_argument("--blink-settings=imagesEnabled=true")
        chrome_bin = os.environ.get("CHROME_BIN")
        if chrome_bin:
            options.binary_location = chrome_bin
        chromedriver_path = os.environ.get("CHROMEDRIVER_PATH")
        if chromedriver_path:
            driver_instance = webdriver.Chrome(
                service=ChromeService(executable_path=chromedriver_path),
                options=options,
            )
        else:
            driver_instance = webdriver.Chrome(options=options)
    
    driver_instance.implicitly_wait(5)
    
    yield driver_instance
    
    # Save screenshot on test failure
    if hasattr(request.node, "rep_call") and request.node.rep_call.failed:
        os.makedirs("tests/selenium/screenshots", exist_ok=True)
        screenshot_path = os.path.join(
            "tests/selenium/screenshots", f"{request.node.name}.png"
        )
        try:
            driver_instance.save_screenshot(screenshot_path)
            print(f"\n[Screenshot captured on failure]: {screenshot_path}")
        except Exception:
            pass

    driver_instance.quit()

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, "rep_" + rep.when, rep)
