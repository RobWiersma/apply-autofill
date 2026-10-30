// Reads a resume (PDF or plain text) into contact info and a list of jobs for the settings page.
// Heuristic: a job starts at a line with a date range ("01/25–08/26", "Jan 2020 - Present"),
// and the lines after it, up to the next job or section heading, are its description.

export async function textFromFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return file.text();
  const pdfjs = await import("./lib/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("lib/pdf.worker.min.js");
  // isEvalSupported: false keeps pdf.js off its eval-based font path (blocked in extensions anyway).
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items } = await (await pdf.getPage(p)).getTextContent();
    for (const it of items) text += it.str + (it.hasEOL ? "\n" : "");
    text += "\n";
  }
  return text;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = String.raw`(?:\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4})`;
const RANGE = new RegExp(String.raw`(${DATE})\s*(?:–|—|-|to)\s*(present|current|now|${DATE})`, "i");
const SECTION = /^(summary|profile|objective|skills|technical skills|core skills|education|projects|certifications?|awards|volunteer\w*|publications|languages|interests|references)\b\s*:?$/i;
const EXPERIENCE = /^(professional |work |relevant )?(experience|employment( history)?|work history|career history)\b\s*:?$/i;
const JOB_WORD = /\b(engineer|developer|programmer|analyst|architect|manager|lead|director|consultant|specialist|administrator|intern|designer|scientist|technician|officer|associate|coordinator|head|vp|president|owner|founder|devops|sre)\b/i;
const BULLET = /^[•▪◦‣●\-*–]\s*/;

function toYm(s) {
  if (!s || /present|current|now/i.test(s)) return "";
  let m = s.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[2].length === 2 ? (+m[2] < 50 ? 2000 : 1900) + +m[2] : +m[2];
    return `${y}-${String(+m[1]).padStart(2, "0")}`;
  }
  m = s.match(/^([a-z]+)\.?\s+(\d{4})$/i);
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}`;
  m = s.match(/^(\d{4})$/);
  return m ? `${m[1]}-01` : "";
}

// "Pacific Gas & Electric — Senior Programmer Analyst San Ramon, CA •" -> company, title, location
function splitHeader(head) {
  head = head.replace(/[\s•|,·]+$/, "").trim();
  let location = "";
  const loc = head.match(/((?:[A-Z][A-Za-z.'-]+\s){0,2}[A-Z][A-Za-z.'-]+,\s*[A-Z]{2}\b(?:\s*\((?:remote|hybrid|on-?site)\))?|\bremote\b)$/i);
  if (loc) {
    // Drop leading words that belong to the job title ("Analyst San Ramon, CA").
    let words = loc[1].split(/\s+/);
    while (words.length > 2 && JOB_WORD.test(words[0])) words.shift();
    location = words.join(" ");
    head = head.slice(0, head.length - location.length).replace(/[\s•|,·]+$/, "").trim();
  }
  // Split on dashes/pipes/"at" first; commas only as a last resort ("Armanino, LLP" is one name).
  let parts = head.split(/\s+(?:—|–|-|\||@|at)\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = head.split(/\s*,\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  let title = "";
  let company = "";
  if (parts.length >= 2) {
    const ti = JOB_WORD.test(parts[1]) || !JOB_WORD.test(parts[0]) ? 1 : 0;
    title = parts[ti];
    company = parts.filter((_, i) => i !== ti).join(", ");
  } else if (parts.length === 1) {
    if (JOB_WORD.test(parts[0])) title = parts[0];
    else company = parts[0];
  }
  return { title, company, location };
}

export function parseResume(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  const contact = {};
  const all = lines.join(" ");
  contact.email = (all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0];
  contact.phone = (all.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [""])[0];
  contact.linkedin = (all.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i) || [""])[0];

  // Work only inside the Experience section when there is one.
  let start = lines.findIndex((l) => EXPERIENCE.test(l));
  let end = lines.length;
  if (start >= 0) {
    const next = lines.findIndex((l, i) => i > start && SECTION.test(l));
    if (next > 0) end = next;
  }
  const body = lines.slice(start + 1, end);

  const jobs = [];
  let job = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const r = line.match(RANGE);
    if (r && line.length < 160) {
      const h = splitHeader(line.slice(0, r.index) + " " + line.slice(r.index + r[0].length));
      // Title or company on its own line just above (common two-line headers).
      const prev = job ? null : body[i - 1];
      if (prev && !RANGE.test(prev) && (!h.title || !h.company)) {
        if (!h.title && JOB_WORD.test(prev)) h.title = prev;
        else if (!h.company) h.company = prev;
      }
      job = {
        ...h,
        start: toYm(r[1]),
        end: toYm(r[2]),
        current: /present|current|now/i.test(r[2]),
        bullets: [],
      };
      jobs.push(job);
      continue;
    }
    if (!job) continue;
    // A new bullet starts with a bullet mark or after a line that ended a sentence;
    // otherwise the PDF just wrapped the previous one.
    const last = job.bullets[job.bullets.length - 1];
    if (BULLET.test(line) || !last || /[.!?]$/.test(last)) job.bullets.push(line.replace(BULLET, ""));
    else job.bullets[job.bullets.length - 1] = `${last} ${line}`;
  }

  return {
    contact,
    jobs: jobs.map(({ bullets, ...j }) => ({ ...j, description: bullets.map((b) => `- ${b}`).join("\n") })),
  };
}
