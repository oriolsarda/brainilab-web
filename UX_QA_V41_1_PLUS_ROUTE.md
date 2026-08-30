# BrainiLab V41.1 — BrainiLab+ route fix

## Fixed
- BrainiLab+ navigation now always uses the absolute route `/plus/`.
- It no longer derives the route from the current profile URL.
- Added a compatibility redirect from `/profile/plus/` to `/plus/`.
- Bumped static assets to v41.1 to avoid stale cached navigation code.

## Expected
From any page, including `/profile/`, clicking BrainiLab+ opens:

http://localhost:8000/plus/

not:

http://localhost:8000/profile/plus/index.html
