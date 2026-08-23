# MenüQR Virtual Printer

Local development utility for visually inspecting what MenüQR Bridge sends to a
Star-compatible TCP printer. It listens on port `9100` and renders received
data in a small Electron window. It is not included in the Bridge installer.

Run from the repository root:

```powershell
npm run virtual-printer
```

Use the private LAN address shown by the tool in Bridge discovery or manual
configuration. Press `Ctrl+C` in the terminal to stop the utility.
