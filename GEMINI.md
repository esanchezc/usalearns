# Project: Form Automation with Playwright & MCP

## Overview
This repository provides automated browser form processing powered by Playwright and the Model Context Protocol (MCP).

## Architecture & Configuration
- **MCP Plugin**: Located at `.agents/plugins/playwright/` configured with `mcp_config.json` referencing `@executeautomation/playwright-mcp-server`.
- **Global / Multi-Client MCP**: Compatible via `mcp.json` and `.vscode/settings.json`.
- **Runtime**: Node.js (`type: module`) with `@playwright/test` and Chromium browser binaries installed.

## Key MCP Tools Available
- `playwright_navigate`: Open URLs.
- `playwright_fill`: Fill inputs, text fields, and text areas.
- `playwright_click`: Click buttons, radio buttons, checkboxes, and tabs.
- `playwright_select`: Select options in dropdown menus.
- `playwright_upload_file`: Upload files into file input elements.
- `playwright_get_visible_text` & `playwright_get_visible_html`: Inspect DOM structure and text.
- `playwright_screenshot`: Capture visual state before and after form submission.
- `playwright_evaluate`: Run JavaScript expressions in page context.

## Scripts
- `npm run example:form` - Run standalone form automation demo.
- `npm test` - Run Playwright test suite.
- `npm run codegen` - Launch Playwright interactive selector & code recorder.
