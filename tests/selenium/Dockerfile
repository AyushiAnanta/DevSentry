FROM python:3.12-slim
WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
  && rm -rf /var/lib/apt/lists/*

COPY tests/selenium/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY tests/selenium ./tests/selenium

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

ENTRYPOINT ["pytest", "tests/selenium", "-v", "--tb=short"]
CMD ["--base-url", "http://client"]
