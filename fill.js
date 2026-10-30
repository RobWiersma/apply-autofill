// Injected on demand into every frame. Fills empty fields in the open application step and
// returns { fields, filled, needs } for background.js to summarize; never clicks Next/Submit.
(async () => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const d = (await api.storage.local.get("autofillData")).autofillData;

  if (!d || !d.firstName) return { noData: true };

  // ---------- helpers ----------
  const norm = (s) =>
    (s || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const textOf = (n) => (n ? n.innerText || n.textContent || "" : "");
  const shadowOf = (e) => e.openOrClosedShadowRoot || e.shadowRoot;

  function deepQuery(root, sel, out = []) {
    root.querySelectorAll(sel).forEach((e) => out.push(e));
    root.querySelectorAll("*").forEach((e) => {
      const s = shadowOf(e);
      if (s) deepQuery(s, sel, out);
    });
    return out;
  }

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== "hidden";
  }

  // ---------- answers ----------
  const fullName = [d.firstName, d.lastName].filter(Boolean).join(" ");
  const cityOnly = (d.city || "").split(",")[0].trim();
  // "Location" fields (LinkedIn's is a city typeahead) want "City, State, Country".
  const locationText = [d.state, d.country].reduce(
    (acc, part) => (part && !norm(acc).includes(norm(part)) ? `${acc}, ${part}` : acc),
    (d.city || "").trim()
  );

  const skills = (d.skills || "")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(.+?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/))
    .filter(Boolean)
    .map((m) => ({ name: norm(m[1]), years: m[2] }))
    .sort((a, b) => b.name.length - a.name.length);

  function yearsFor(q) {
    for (const s of skills) {
      const esc = s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(q)) return s.years;
    }
    return d.yearsDefault || "";
  }

  const customRules = (d.rules || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("=>"))
    .map((l) => {
      const i = l.indexOf("=>");
      const pat = l.slice(0, i).trim();
      const answer = l.slice(i + 2).trim();
      const re = pat.match(/^\/(.+)\/([a-z]*)$/);
      if (re) {
        try {
          const rx = new RegExp(re[1], re[2].includes("i") ? re[2] : re[2] + "i");
          return { test: (q) => rx.test(q), answer };
        } catch {
          return null;
        }
      }
      const p = norm(pat);
      return { test: (q) => q.includes(p), answer };
    })
    .filter(Boolean);

  // Order matters: specific yes/no questions before generic contact fields
  // ("authorized to work in this country" must not hit the country rule).
  const BUILTIN = [
    [/sponsor|visa status|require.*visa/, () => d.needsSponsorship],
    [/authori[sz]ed to work|legally (authori[sz]ed|eligible|able|permitted)|eligible to work|right to work|work authori[sz]ation/, () => d.workAuthorized],
    [/18 years|over 18|at least 18|legal age/, () => "Yes"],
    [/background check|drug (test|screen)/, () => d.backgroundCheck],
    [/relocat/, () => d.relocate],
    [/commut|on-?site|in[- ]office|in the office|hybrid/, () => d.commute],
    [/(completed|have|hold|possess|earned).*(degree|level of education)/, () => d.hasDegree],
    [/highest (level of )?education|degree/, () => d.education],
    [/how many years|years.*experience|experience.*years/, (q) => yearsFor(q)],
    [/salary|compensation|pay (expectation|requirement)|expected pay|desired pay|rate expectation/, () => d.salary],
    [/notice period|start date|available to start|when can you start|earliest start/, () => d.startDate],
    [/hear about|how did you (find|learn)|referral source/, () => "LinkedIn"],
    [/gender|\bsex\b/, () => d.gender],
    [/\brace\b|ethnicity|hispanic|latino/, () => d.ethnicity],
    [/veteran|military/, () => d.veteran],
    [/disabilit/, () => d.disability],
    [/first name|given name/, () => d.firstName],
    [/last name|surname|family name/, () => d.lastName],
    [/full name|^name\b(?!\s+of)|your name|legal name/, () => fullName], // not "Name of current employer"
    [/e-?mail/, () => d.email],
    [/country code|phone country|dialing code/, () => d.phoneCountry],
    [/phone|mobile|\bcell\b/, () => d.phone],
    [/linkedin/, () => d.linkedin],
    [/github/, () => d.github],
    [/website|portfolio|personal (site|url)|\burl\b/, () => d.website],
    [/street|address line 1|^address|mailing address/, () => d.address],
    [/location/, () => locationText],
    [/\bcity\b/, () => cityOnly],
    [/\bstate\b|province/, () => d.state],
    [/\bzip\b|postal/, () => d.zip],
    [/\bcountry\b/, () => d.country],
    [/(current|recent|most recent) (job )?title|job title|headline/, () => d.currentTitle],
    [/current (company|employer)|company name/, () => d.currentCompany],
    [/cover letter|summary|why (are you|do you)/, () => d.coverLetter],
  ];

  // Signature date on self-identification forms (e.g. the disability form's "Date").
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = { month: pad(now.getMonth() + 1), day: pad(now.getDate()), year: String(now.getFullYear()) };
  BUILTIN.push([/^date\b(?! of birth)|today'?s date|signature date|date signed/, () => `${today.month}/${today.day}/${today.year}`]);

  function answerFor(q) {
    for (const r of customRules) if (r.test(q)) return r.answer;
    for (const [rx, fn] of BUILTIN) if (rx.test(q)) return (fn(q) || "").toString().trim();
    return "";
  }

  // Self-ID forms often ask "Please check one of the boxes below" and only the choices say
  // what it's about ("Yes, I have a disability…"), so fall back to reading the choices.
  const groupAnswer = (q, opts) => answerFor(q) || answerFor(opts.map((o) => o.text).join(" | "));

  // ---------- reading the form ----------
  function byIds(el, ids) {
    const root = el.getRootNode();
    return ids
      .split(/\s+/)
      .map((id) => textOf(root.getElementById ? root.getElementById(id) : document.getElementById(id)))
      .join(" ");
  }

  function labelOf(el) {
    if (el.labels && el.labels.length) return textOf(el.labels[0]);
    if (el.getAttribute("aria-labelledby")) return byIds(el, el.getAttribute("aria-labelledby"));
    return el.getAttribute("aria-label") || "";
  }

  const CONTROLS = 'input:not([type=hidden]), select, textarea, button[aria-haspopup="listbox"]';

  // For fields with no label (e.g. Gem forms): the text of the largest ancestor that holds
  // only these controls, minus the options' own labels ("Yes", "No").
  function surroundingText(members) {
    let n = members[0];
    let text = "";
    for (let i = 0; i < 6 && n.parentElement; i++) {
      n = n.parentElement;
      if ([...n.querySelectorAll(CONTROLS)].some((c) => !members.includes(c))) break;
      text = textOf(n);
    }
    for (const m of members) {
      const l = m.labels && m.labels.length ? textOf(m.labels[0]).trim() : "";
      if (l) text = text.replace(l, " ");
    }
    return text;
  }

  // Radios with no name or fieldset: the nearest ancestor holding other radios is their group.
  function radioBox(el) {
    let n = el;
    while ((n = n.parentElement)) if ([...n.querySelectorAll("input[type=radio]")].some((r) => r !== el)) return n;
    return null;
  }

  function questionFor(el, group = [el]) {
    if (el.type === "radio") {
      const box = el.closest("fieldset, [role=radiogroup]");
      if (box) {
        const legend = box.querySelector("legend");
        if (legend) return norm(textOf(legend));
        if (box.getAttribute("aria-labelledby")) return norm(byIds(box, box.getAttribute("aria-labelledby")));
        if (box.getAttribute("aria-label")) return norm(box.getAttribute("aria-label"));
      }
      // The radio's own label is just its option ("Yes"); the question is around the group.
      return norm(surroundingText(group));
    }
    const q =
      labelOf(el) ||
      el.getAttribute("placeholder") ||
      textOf(el.closest("[data-test-form-element], .fb-dash-form-element, .jobs-easy-apply-form-element")) ||
      el.name ||
      el.id ||
      surroundingText([el]);
    return norm(q);
  }

  // ---------- writing values ----------
  function setValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  const PLACEHOLDER = /^(select an option|select one|select|choose.*|please select.*|--.*|)$/;
  const alnum = (s) => s.replace(/[^a-z0-9]/g, "");

  function pick(options, answer) {
    const a = norm(answer);
    if (!a) return null;
    const c = options.filter((o) => !PLACEHOLDER.test(o.text));
    return (
      c.find((o) => o.text === a) ||
      c.find((o) => o.text.startsWith(a)) ||
      c.find((o) => o.text.includes(a)) ||
      c.find((o) => o.text.length >= 3 && a.includes(o.text)) ||
      // "Bachelors" vs "Bachelor's Degree"
      c.find((o) => alnum(o.text).length >= 3 && alnum(a).includes(alnum(o.text))) ||
      null
    );
  }

  // A question's container: radio/checkbox groups, or a Workday form field.
  const GROUP = "fieldset, [role=radiogroup], [role=group], [data-automation-id^=formField]";

  // The group's own question text: legend, aria label, or a label not tied to one of its options.
  function groupQuestion(group, members) {
    const legend = group.querySelector("legend");
    if (legend) return textOf(legend);
    if (group.getAttribute("aria-labelledby")) return byIds(group, group.getAttribute("aria-labelledby"));
    if (group.getAttribute("aria-label")) return group.getAttribute("aria-label");
    const own = [...group.querySelectorAll("label")].find((l) => !members.some((m) => [...(m.labels || [])].includes(l)));
    return own ? textOf(own) : "";
  }

  function mark(el, ok) {
    const target = /^(radio|checkbox)$/.test(el.type) ? el.closest(GROUP) || el : el;
    target.style.outline = ok ? "2px solid #2e7d32" : "2px dashed #e65100";
    target.style.outlineOffset = "2px";
  }

  const key = (el, type, k) =>
    el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, bubbles: true }));

  const press = (el) => {
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const E = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, button: 0, view: window }));
    }
  };

  // Typeaheads (LinkedIn location) and custom dropdowns (Greenhouse) only accept
  // a value picked from their option list.
  async function chooseSuggestion(el, typed) {
    const want = norm(typed);
    const first = want.split(",")[0];
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      // Some dropdowns (react-select) filter on typing but only open when clicked.
      if (i === 3 && el.getAttribute("aria-expanded") === "false") press(el);
      const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      const root = el.getRootNode();
      const list = listId && root.getElementById ? root.getElementById(listId) : null;
      const opts = (list ? [...list.querySelectorAll("[role=option]")] : deepQuery(document, "[role=listbox] [role=option]")).filter(visible);
      if (!opts.length) continue;
      const best =
        opts.find((o) => norm(textOf(o)) === want) ||
        opts.find((o) => norm(textOf(o)).startsWith(first)) ||
        opts[0];
      for (const t of ["mousedown", "mouseup"]) best.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      best.click();
      return true;
    }
    // No list appeared: try the keyboard way.
    key(el, "keydown", "ArrowDown");
    key(el, "keydown", "Enter");
    return false;
  }

  // ---------- scope: the open Easy Apply modal, else the page minus header/search ----------
  const dialogs = deepQuery(document, '[role="dialog"], dialog[open], .artdeco-modal').filter(
    (dl) => visible(dl) && deepQuery(dl, "input, select, textarea").length
  );
  let fields = dialogs.length
    ? deepQuery(dialogs[dialogs.length - 1], "input, select, textarea")
    : deepQuery(document, "input, select, textarea").filter(
        (e) => !e.closest("header, nav, [role=search], [role=banner], form[role=search]")
      );

  const SKIP_TYPES = /^(hidden|submit|button|reset|image|file|password|search)$/;
  fields = fields.filter(
    (e) =>
      !SKIP_TYPES.test(e.type) &&
      !e.disabled &&
      !e.readOnly &&
      e.getAttribute("aria-hidden") !== "true" &&
      (visible(e) || (e.labels && e.labels[0] && visible(e.labels[0])))
  );

  // Workday-style dropdowns: a button showing "Select One" that opens a listbox.
  const dropdowns = deepQuery(dialogs.length ? dialogs[dialogs.length - 1] : document, 'button[aria-haspopup="listbox"]').filter(
    (b) => visible(b) && !b.disabled && PLACEHOLDER.test(norm(textOf(b)))
  );

  if (!fields.length && !dropdowns.length) return { fields: 0, filled: 0, needs: [] };

  // ---------- fill ----------
  let filled = 0;
  const needs = new Set();
  const doneGroups = new Set();

  for (const el of fields) {
    if (el.type === "radio") {
      const keyOf = (r) => r.name || r.closest("fieldset, [role=radiogroup]") || radioBox(r);
      const groupKey = keyOf(el);
      if (doneGroups.has(groupKey)) continue;
      doneGroups.add(groupKey);
      const group = fields.filter((r) => r.type === "radio" && keyOf(r) === groupKey);
      if (group.some((r) => r.checked)) continue;
      const q = questionFor(el, group);
      const opts = group.map((r) => ({ el: r, text: norm(labelOf(r) || r.value) }));
      const opt = pick(opts, groupAnswer(q, opts));
      if (opt) {
        opt.el.click();
        mark(el, true);
        filled++;
      } else {
        mark(el, false);
        needs.add(q);
      }
      continue;
    }

    const q = questionFor(el);

    if (el.type === "checkbox") {
      // A group of checkboxes answering one question (e.g. "highest education level"):
      // tick the one matching the answer.
      const box = el.closest(GROUP);
      const group = box ? fields.filter((c) => c.type === "checkbox" && c.closest(GROUP) === box) : [];
      if (group.length > 1) {
        if (doneGroups.has(box)) continue;
        doneGroups.add(box);
        if (group.some((c) => c.checked)) continue;
        const gq = norm(groupQuestion(box, group));
        const opts = group.map((c) => ({ el: c, text: norm(labelOf(c) || c.value) }));
        const opt = pick(opts, groupAnswer(gq, opts));
        if (opt) {
          opt.el.click();
          mark(el, true);
          filled++;
        } else {
          mark(el, false);
          needs.add(gq);
        }
        continue;
      }
      // A lone checkbox: only tick it if the user answered "yes" to it via custom answers.
      const a = norm(answerFor(q));
      if (!el.checked && /^(yes|true|check|checked)$/.test(a)) {
        el.click();
        mark(el, true);
        filled++;
      }
      continue;
    }

    if (el instanceof HTMLSelectElement) {
      const cur = el.options[el.selectedIndex];
      if (cur && !PLACEHOLDER.test(norm(cur.text))) continue;
      const opt = pick([...el.options].map((o) => ({ el: o, text: norm(o.text) })), answerFor(q));
      if (opt) {
        setValue(el, opt.el.value);
        mark(el, true);
        filled++;
      } else {
        mark(el, false);
        needs.add(q);
      }
      continue;
    }

    // text / number / email / tel / textarea
    if (el.value && el.value.trim()) continue;
    // react-select shows its chosen value in a separate element, leaving the input empty.
    if (el.closest("[class*=control]")?.querySelector("[class*=single-value], [class*=multi-value]")) continue;
    // Workday splits a date into Month / Day / Year boxes; fill today's date only when the
    // field is a plain "Date" (the self-ID signature date), never a birth date.
    const part = q.match(/^(month|day|year)$/);
    const box = part && el.closest(GROUP);
    const isSignatureDate = box && /\bdate\b/.test(norm(groupQuestion(box, [el]))) && !/birth/.test(norm(textOf(box)));
    const a = part ? (isSignatureDate ? today[part[1]] : "") : answerFor(q);
    if (!a) {
      mark(el, false);
      needs.add(q);
      continue;
    }
    el.focus();
    setValue(el, el.type === "number" ? (parseFloat(a.replace(/[^0-9.]/g, "")) || "").toString() : a);
    mark(el, true);
    filled++;
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")) {
      key(el, "keyup", a.slice(-1)); // some typeaheads only search on keyup
      // Pick now: dropdowns like Greenhouse's clear the typed text once focus moves on.
      if (!(await chooseSuggestion(el, a))) {
        mark(el, false);
        filled--;
        needs.add(q + " (pick from the dropdown)");
      }
    }
  }

  for (const b of dropdowns) {
    const box = b.closest(GROUP);
    const q = norm(
      labelOf(b).replace(/\b(select one|required)\b/gi, "") ||
        (box ? groupQuestion(box, [b]) : "")
    );
    const a = answerFor(q);
    if (!a) {
      mark(b, false);
      needs.add(q);
      continue;
    }
    press(b);
    let opt = null;
    for (let i = 0; i < 30 && !opt; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const listId = b.getAttribute("aria-controls") || b.getAttribute("aria-owns");
      const list = listId ? document.getElementById(listId) : null;
      const opts = (list ? [...list.querySelectorAll("[role=option]")] : deepQuery(document, "[role=listbox] [role=option]")).filter(visible);
      if (opts.length) {
        opt = pick(opts.map((o) => ({ el: o, text: norm(textOf(o)) })), a);
        if (!opt) break;
      }
    }
    if (opt) {
      press(opt.el);
      mark(b, true);
      filled++;
    } else {
      key(document.activeElement || b, "keydown", "Escape");
      mark(b, false);
      needs.add(q);
    }
    await new Promise((r) => setTimeout(r, 200)); // let the list close before the next one
  }

  return { fields: fields.length + dropdowns.length, filled, needs: [...needs] };
})();
