# Browser & Form Automation with Playwright MCP

This repository is configured with **Playwright** and the **Playwright Model Context Protocol (MCP) Server** to enable direct browser interaction and form automation through AI agents.

---

## 📁 Repository Structure

```text
.
├── .agents/
│   └── plugins/
│       └── playwright/
│           ├── plugin.json        # Plugin manifest
│           ├── mcp_config.json    # MCP server definition for Antigravity
│           └── rules/
│               └── AGENTS.md      # Form automation behavior guidelines
├── examples/
│   └── form-automation-example.js # Standalone Playwright automation script
├── tests/
│   └── sample-form.spec.js        # Playwright test suite
├── .env.example                   # Environment configuration template
├── .gitignore                     # Git ignore rules for Playwright & Node
├── GEMINI.md                      # Workspace context & memory bank
├── mcp.json                       # Universal MCP client configuration
├── package.json                   # Project dependencies and helper scripts
└── playwright.config.js           # Playwright testing configuration
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18+ (verified with v26)
- **npm**: v10+

### 2. Install Dependencies & Browsers
All dependencies and the Chromium browser binary have already been installed in this workspace:
```bash
npm install
npx playwright install chromium
```

---

## ⚙️ MCP Server Configuration

### Workspace Plugin (Antigravity)
The MCP server is configured in `.agents/plugins/playwright/mcp_config.json`:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    }
  }
}
```

### Universal MCP Client Config (`mcp.json` / Claude Desktop / Cursor)
For other MCP hosts, `mcp.json` is provided at the repository root:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    }
  }
}
```

---

## 🛠 Available MCP Tools for Form Automation

| Tool | Purpose |
| :--- | :--- |
| `playwright_navigate` | Navigate to any URL |
| `playwright_fill` | Fill text inputs, passwords, email fields, textareas |
| `playwright_click` | Click submit buttons, links, radio buttons, checkboxes |
| `playwright_select` | Select options from `<select>` dropdowns |
| `playwright_hover` | Hover over elements (dropdown menus, tooltips) |
| `playwright_upload_file` | Upload local files to file input elements |
| `playwright_press_key` | Send keyboard keys (Enter, Tab, Escape, etc.) |
| `playwright_get_visible_text` | Extract visible text on the page for verification |
| `playwright_get_visible_html` | Inspect DOM hierarchy and locator attributes |
| `playwright_screenshot` | Capture full-page or element screenshots |
| `playwright_evaluate` | Run arbitrary JavaScript in the browser context |
| `start_codegen_session` | Start recording user actions to generate Playwright code |

---

## 📋 Available Helper Commands

- **Run standalone form example**:
  ```bash
  npm run example:form
  ```
- **Run Playwright test suite**:
  ```bash
  npm test
  ```
- **Launch Playwright interactive Codegen (selector helper)**:
  ```bash
  npm run codegen
  ```
- **Start MCP server directly**:
  ```bash
  npm run mcp:stdio
  ```

---

## 💡 Form Automation Best Practices

1. **Inspect Elements**: Use `playwright_get_visible_html` or `npm run codegen` to get stable locators (`getByRole`, `getByLabel`, `#id`, or `[name="..."]`).
2. **Pre-fill Validation**: Fill inputs sequentially and use `playwright_screenshot` to verify filled fields before clicking submit.
3. **Handle Dynamic Forms**: Allow elements to resolve automatically; Playwright waits for element actionability (visible, enabled, stable).
