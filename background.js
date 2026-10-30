// Job sites that embed their application form in a frame from another domain
// (e.g. a company careers page showing a Greenhouse form). activeTab only covers
// the top page, so these need host permission for the filler to reach the form.
const ATS_ORIGINS = [
  "*://*.greenhouse.io/*",
  "*://*.lever.co/*",
  "*://*.ashbyhq.com/*",
  "*://*.myworkdayjobs.com/*",
  "*://*.myworkdaysite.com/*",
  "*://*.smartrecruiters.com/*",
  "*://*.icims.com/*",
  "*://*.jobvite.com/*",
  "*://*.bamboohr.com/*",
  "*://*.workable.com/*",
  "*://*.adp.com/*",
  "*://*.ultipro.com/*",
  "*://*.paylocity.com/*",
  "*://*.applytojob.com/*",
  "*://*.breezy.hr/*",
  "*://*.recruitee.com/*",
  "*://*.dayforcehcm.com/*",
  "*://*.taleo.net/*",
  "*://*.isolvedhire.com/*",
];

// Toolbar button / Alt+Shift+F: inject the filler into every frame, then show one summary.
browser.action.onClicked.addListener(async (tab) => {
  // Must be the first await so it still counts as a user action. No prompt once granted.
  try {
    await browser.permissions.request({ origins: ATS_ORIGINS });
  } catch (e) {
    console.warn("Apply Autofill: permission request failed", e);
  }

  let results = [];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["fill.js"],
    });
  } catch (e) {
    console.error("Apply Autofill: could not run on this page", e);
    return;
  }

  const frames = results.map((r) => r && r.result).filter(Boolean);
  if (frames.some((f) => f.noData)) {
    await toast(tab.id, "Add your info first. Opening settings…", []);
    browser.runtime.openOptionsPage();
    return;
  }

  const fields = frames.reduce((n, f) => n + (f.fields || 0), 0);
  const filled = frames.reduce((n, f) => n + (f.filled || 0), 0);
  const needs = [...new Set(frames.flatMap((f) => f.needs || []))];

  if (!fields) {
    await toast(tab.id, "No form fields found on this page.", []);
    return;
  }
  await toast(
    tab.id,
    `Filled ${filled} field${filled === 1 ? "" : "s"}.` +
      (needs.length ? ` ${needs.length} need you (orange):` : " Review, then click Next."),
    needs
  );
});

function toast(tabId, title, items) {
  return browser.scripting
    .executeScript({ target: { tabId }, func: showToast, args: [title, items] })
    .catch((e) => console.error("Apply Autofill: could not show summary", e));
}

// Runs in the top page.
function showToast(title, items) {
  document.getElementById("apply-autofill-toast")?.remove();
  const box = document.createElement("div");
  box.id = "apply-autofill-toast";
  box.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 14px;" +
    "background:#1d2226;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:8px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer";
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.textContent = title;
  box.appendChild(h);
  if (items.length) {
    const ul = document.createElement("ul");
    ul.style.cssText = "margin:6px 0 0;padding-left:18px";
    for (const it of items.slice(0, 6)) {
      const li = document.createElement("li");
      li.textContent = it.length > 90 ? it.slice(0, 87) + "…" : it;
      ul.appendChild(li);
    }
    if (items.length > 6) {
      const li = document.createElement("li");
      li.textContent = `…and ${items.length - 6} more`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const tip = document.createElement("div");
    tip.style.cssText = "margin-top:6px;opacity:.75;font-size:12px";
    tip.textContent = "Tip: add answers for these under Custom answers in the extension settings.";
    box.appendChild(tip);
  }
  box.onclick = () => box.remove();
  document.body.appendChild(box);
  setTimeout(() => box.remove(), items.length ? 12000 : 5000);
}

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});
