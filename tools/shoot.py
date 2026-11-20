"""给 designs/ 里导出的静态页截图：1440 宽，2 倍像素，整页。

页面里的字体本来从 Google Fonts 加载。截图的机器连不上 Google Fonts 时，
把那条样式表请求换成 jsDelivr 上 Fontsource 的同名字体（字形、字重都一样）。

用法：python3 tools/shoot.py        （需要 pip install playwright）
"""
import asyncio
import pathlib
import re
import shutil
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [
    "designs/a-console/index.html",
    "designs/a-console/allow.html",
    "designs/b-ledger/index.html",
    "designs/c-recorder/index.html",
]
WIDTH, HEIGHT = 1440, 1024
# 优先用系统里的 Chromium；没有的话用 Playwright 自带的浏览器（先运行 playwright install chromium）
CHROMIUM = shutil.which("chromium") or shutil.which("chromium-browser")


def fontsource_css(url: str) -> str:
    rules = []
    for family in parse_qs(urlparse(url).query).get("family", []):
        name, _, axes = family.partition(":")
        slug = name.strip().lower().replace(" ", "-")
        weights = re.findall(r"\d{3}", axes.split("@", 1)[1]) if "@" in axes else ["400"]
        rules += [f'@import url("https://cdn.jsdelivr.net/npm/@fontsource/{slug}@5/{w}.css");' for w in weights]
    return "\n".join(rules)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=2)

        async def swap(route):
            await route.fulfill(status=200, content_type="text/css", body=fontsource_css(route.request.url))

        await page.route(re.compile(r"^https://fonts\.googleapis\.com/"), swap)
        for rel in PAGES:
            await page.goto((ROOT / rel).as_uri(), wait_until="networkidle")
            await page.evaluate("document.fonts.ready")
            await page.wait_for_timeout(300)
            height = await page.evaluate("document.documentElement.scrollHeight")
            out = ROOT / rel.replace(".html", ".png")
            await page.screenshot(path=str(out), full_page=True)
            print(f"{out.relative_to(ROOT)}  {WIDTH}x{height}")
        await browser.close()


asyncio.run(main())
