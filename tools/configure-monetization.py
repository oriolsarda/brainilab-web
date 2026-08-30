#!/usr/bin/env python3
"""
Configure BrainiLab's public AdSense identifiers before launch.

This tool intentionally handles PUBLIC ad identifiers only.
It never accepts Stripe secrets or Supabase secret/service-role keys.

Example:
  python3 tools/configure-monetization.py \
    --publisher ca-pub-1234567890123456 \
    --home 1111111111 \
    --games 2222222222 \
    --daily 3333333333 \
    --quiz-result 4444444444 \
    --rankings 5555555555 \
    --about 6666666666
"""

from pathlib import Path
import argparse
import re

ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/"assets/js/monetization-config.js"
SHELL=ROOT/"assets/js/shell.bundle.js"
ADS_TXT=ROOT/"ads.txt"

SLOT_MAP={
    "home":"home_after_play",
    "games":"games_mid_content",
    "daily":"daily_lower",
    "quiz_result":"quiz_result",
    "rankings":"rankings_after_board",
    "about":"about_lower",
}

def require_publisher(value:str)->str:
    value=value.strip()
    if not re.fullmatch(r"ca-pub-\d{10,24}",value):
        raise SystemExit(
            "Publisher must look like ca-pub-1234567890123456"
        )
    return value

def require_slot(value:str)->str:
    value=value.strip()
    if not re.fullmatch(r"\d{5,30}",value):
        raise SystemExit(
            f"Invalid AdSense slot ID: {value!r}"
        )
    return value

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--publisher",required=True)
    parser.add_argument("--home",required=True)
    parser.add_argument("--games",required=True)
    parser.add_argument("--daily",required=True)
    parser.add_argument("--quiz-result",dest="quiz_result",required=True)
    parser.add_argument("--rankings",required=True)
    parser.add_argument("--about",required=True)
    args=parser.parse_args()

    publisher=require_publisher(args.publisher)

    slots={
        key:require_slot(
            getattr(args,key)
        )
        for key in SLOT_MAP
    }

    for config_file in (CONFIG,SHELL):
        text=config_file.read_text(encoding="utf-8")

        text=re.sub(
            r'publisherId:"[^"]*"',
            f'publisherId:"{publisher}"',
            text,
            count=1
        )

        for arg_key,config_key in SLOT_MAP.items():
            value=slots[arg_key]
            text=re.sub(
                rf'{re.escape(config_key)}:"[^"]*"',
                f'{config_key}:"{value}"',
                text,
                count=1
            )

        config_file.write_text(
            text,
            encoding="utf-8"
        )

    numeric=publisher.removeprefix("ca-pub-")
    ADS_TXT.write_text(
        "# BrainiLab ads.txt\n"
        f"google.com, pub-{numeric}, DIRECT, f08c47fec0942fa0\n",
        encoding="utf-8"
    )

    # AdSense supports account meta verification. Inject the public account
    # marker into every public HTML head, while leaving Admin untouched.
    for html in ROOT.rglob("*.html"):
        rel=html.relative_to(ROOT)

        if "admin" in rel.parts:
            continue

        source=html.read_text(encoding="utf-8")

        meta=(
            f'<meta name="google-adsense-account" '
            f'content="{publisher}"/>'
        )

        if 'name="google-adsense-account"' in source:
            source=re.sub(
                r'<meta\s+name="google-adsense-account"\s+content="[^"]*"\s*/?>',
                meta,
                source,
                count=1
            )
        else:
            source=source.replace(
                "<head>",
                "<head>\n"+meta,
                1
            )

        html.write_text(source,encoding="utf-8")

    print("BrainiLab public AdSense configuration updated.")
    print("Ads remain controlled by Admin runtime flags.")

if __name__=="__main__":
    main()
