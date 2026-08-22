# Playwright Form Automation Guidelines

When performing web navigation and form automation tasks using Playwright MCP:

1. **Inspection before Interaction**:
   - Navigate to the target page with `playwright_navigate`.
   - Inspect the form structure using `playwright_get_visible_text` or `playwright_get_visible_html` to identify input names, IDs, placeholders, and labels.

2. **Form Interaction Sequence**:
   - Use `playwright_fill` with accurate CSS/XPath selectors or text locators.
   - Use `playwright_select` for standard `<select>` dropdowns.
   - For custom dropdowns or multi-step pickers, use `playwright_click` followed by option selection.
   - For file inputs, use `playwright_upload_file`.
   - Use `playwright_press_key` (e.g. "Enter", "Tab") when autocomplete or keyboard confirmation is needed.

3. **Validation & Verification**:
   - Always take a screenshot (`playwright_screenshot`) before submitting critical forms to verify all fields are populated correctly.
   - Check response status and post-submission confirmation states.
