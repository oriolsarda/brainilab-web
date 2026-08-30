# BrainiLab V40.1 — Ads Test Mode Fix

## Desktop

From the V40.1 folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/games/?ads_test=1
```

Expected immediately, fixed at the bottom-left:

```text
ADS TEST MODE
1 placement
games_mid_content
```

At the real production placement, below the game-category cards:

```text
AD TEST
games_mid_content
```

## Real phone on the same Wi-Fi

Use the computer's LAN IP, for example:

```text
http://192.168.1.25:8000/games/?ads_test=1
```

Accepted development hosts:

```text
localhost
127.0.0.1
*.local
10.x.x.x
172.16–31.x.x
192.168.x.x
file://
```

A public production hostname cannot activate this test override.

## Safety

`ads_test=1`:

- does not contact AdSense
- does not require publisher/slot IDs
- ignores monetization runtime flags
- ignores Plus entitlement
- is only for local/LAN layout QA
