# Tests

These boot the whole app in Node (no browser needed) and check it end to end.

    npm install jsdom fake-indexeddb
    node tests/test.js           # screens, logging, imports, backups, insights, timer
    node tests/test-cloud.js     # two devices, one account: sign-in, sync, offline catch-up
    node tests/test-upgrade.js   # an older local database upgrading in place
    node tests/test-file.js      # a browser that blocks the app database
    node tests/test-broken-db.js # a local database left in a broken state

Run them from the project folder after any substantial change. Every check
prints a line, and the last line says whether anything failed.
