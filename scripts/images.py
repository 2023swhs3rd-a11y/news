#!/usr/bin/env python3
"""기사 대표 이미지를 위키미디어 공용(Wikimedia Commons)에서 찾아 내려받고, 출처·라이선스를 원고에 적는다.

자유 이용이 허락된 이미지(퍼블릭 도메인, CC0, CC BY, CC BY-SA)만 쓴다. NASA·ESA 사진도 공용에 올라 있으면 여기서 찾는다.
GitHub Actions(이미지 가져오기)에서 실행한다. 표준 라이브러리만 쓴다.

원고의 기사에 다음 중 하나를 적어 두면:
  "image": {"query": "silicon wafer", "alt": "반도체 웨이퍼"}           # 검색해서 첫 번째 알맞은 이미지
  "image": {"file": "File:Silicon wafer.jpg", "alt": "반도체 웨이퍼"}  # 파일을 직접 지정
이 스크립트가 assets/img/<발행일>/<기사 id>.jpg 로 내려받고 src·credit·license·license_url·source_url 을 채운다.
이미 src 가 있는 기사는 건너뛴다(--force 면 다시 받음).

  python scripts/images.py --date 2026-10-26
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://commons.wikimedia.org/w/api.php"
UA = "weekly-news-images/1.0 (https://github.com/2023swhs3rd-a11y/news; school news site)"
WIDTH = 960
# 학생용 사이트에 그대로 써도 되는 라이선스만. NC(비영리)·ND(변경 금지)·저작권 표시 없음은 쓰지 않는다.
FREE = re.compile(r"^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]\d)", re.I)
TAG_RE = re.compile(r"<[^>]+>")


def get(params):
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def text(v):
    return re.sub(r"\s+", " ", html.unescape(TAG_RE.sub(" ", v or ""))).strip()


def info(pages, landscape=False):
    """imageinfo 결과를 쓰기 좋은 모양으로. 자유 라이선스가 아니면 버린다. 검색 결과는 16:9 카드에 맞는 가로 사진만."""
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = text(meta.get("LicenseShortName", {}).get("value"))
        if not FREE.match(lic) or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        w, h = ii.get("width", 0), ii.get("height", 1)
        if w < 800 or (landscape and not 1.2 <= w / h <= 2.2):
            continue
        out.append({
            "title": p["title"],
            "thumb": ii.get("thumburl") or ii.get("url"),
            "source_url": ii.get("descriptionurl"),
            "license": lic,
            "license_url": text(meta.get("LicenseUrl", {}).get("value")),
            "credit": text(meta.get("Artist", {}).get("value"))[:200] or "작자 미상",
            "desc": text(meta.get("ImageDescription", {}).get("value"))[:200],
        })
    return out


def lookup(image):
    common = {"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata|mime|size", "iiurlwidth": WIDTH}
    if image.get("file"):
        return info(get({**common, "titles": image["file"]}).get("query", {}).get("pages", []))
    data = get({**common, "generator": "search", "gsrsearch": f"filetype:bitmap {image['query']}",
                "gsrnamespace": 6, "gsrlimit": 15})
    pages = sorted(data.get("query", {}).get("pages", []), key=lambda p: p.get("index", 99))
    return info(pages, landscape=True)


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        path.write_bytes(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    path = ROOT / "data" / "issues" / f"{args.date}.json"
    issue = json.loads(path.read_text(encoding="utf-8"))
    outdir = ROOT / "assets" / "img" / args.date
    report = []
    for a in issue["articles"]:
        image = a.get("image")
        if not image or (image.get("src") and not args.force):
            continue
        if not (image.get("query") or image.get("file")):
            continue
        try:
            found = lookup(image)
        except Exception as e:  # 한 기사가 실패해도 나머지는 계속
            report.append(f"- {a['id']}: 검색 실패 ({type(e).__name__}: {e})")
            continue
        if not found:
            report.append(f"- {a['id']}: 자유 라이선스 이미지 없음 ({image.get('file') or image.get('query')})")
            continue
        pick = found[0]
        ext = ".png" if pick["thumb"].lower().endswith(".png") else ".jpg"
        outdir.mkdir(parents=True, exist_ok=True)
        dest = outdir / f"{a['id']}{ext}"
        download(pick["thumb"], dest)
        image.update({
            "file": pick["title"],
            "src": dest.relative_to(ROOT).as_posix(),
            "credit": pick["credit"],
            "license": pick["license"],
            "license_url": pick["license_url"],
            "source_url": pick["source_url"],
        })
        image.pop("query", None)
        others = ", ".join(f["title"] for f in found[1:4])
        report.append(f"- {a['id']}: {pick['title']} ({pick['license']}, {pick['credit']})" + (f"\n  다른 후보: {others}" if others else ""))
        time.sleep(1)
    path.write_text(json.dumps(issue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    msg = "\n".join(report) or "- 새로 가져올 이미지 없음"
    print(msg)
    (ROOT / ".images-report.txt").write_text(msg + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
