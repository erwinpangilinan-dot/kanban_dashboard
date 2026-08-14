# Shared routing for both entry points (LAN on :80, Cloudflare Tunnel on :8080).
# Included rather than duplicated so the two listeners cannot drift apart.
# Each server block sets $client_proto before including this file.

location /api/ {
    # No add_header here: the API sets its own headers via helmet, and
    # adding a second set produces conflicting duplicates.
    proxy_pass http://api:3001;
    proxy_http_version 1.1;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # Overwritten, not appended: anything the caller sent is untrusted, and on
    # the tunnel listener real_ip has already resolved $remote_addr to the true
    # client. This leaves exactly one address for the API to read, so its
    # rate limiter keys on the real caller and TRUST_PROXY_HOPS stays 1.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $client_proto;
}

location / {
    # nginx serves the app shell, so the CSP has to live here — a policy set
    # by the API would never reach the HTML. Google Fonts is allowed because
    # index.html loads Inter from it; drop those two hosts if the font is
    # ever vendored locally. 'unsafe-inline' for styles is required by the
    # inline style attributes React emits.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    try_files $uri $uri/ /index.html;
}
