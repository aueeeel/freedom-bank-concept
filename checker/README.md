# Local CQA checker

See ../LOCAL-PROJECT.md for setup and limits. Code, synthetic retrieval memory and tests are included. Client data, credentials, databases and model weights are intentionally local-only.

Default config/checklist.json preserves the current app profile. config/checklist.official.json has the official 10/15/20/20/15/15/5 submission weights. Quality scales remain consultation /20 and dialogue /10. Use the official file explicitly for competition exports.

Run tests from this folder: python -m unittest discover -s tests. These tests use scripted outputs, not paid model requests.
