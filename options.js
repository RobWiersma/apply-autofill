const form = document.getElementById("form");
const status = document.getElementById("status");
const jobsBox = document.getElementById("jobs");
const jobTemplate = document.getElementById("jobTemplate");

for (const sel of form.querySelectorAll("select")) {
  for (const v of ["", "Yes", "No"]) sel.add(new Option(v || "(skip, I'll answer)", v));
}

// ---------- work history (a list, stored as data.jobs) ----------
function addJob(job = {}) {
  const card = jobTemplate.content.firstElementChild.cloneNode(true);
  for (const el of card.querySelectorAll("[data-job]")) {
    const v = job[el.dataset.job];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  }
  card.querySelector(".removeJob").onclick = () => card.remove();
  jobsBox.appendChild(card);
}

function readJobs() {
  return [...jobsBox.querySelectorAll(".job")]
    .map((card) => {
      const job = {};
      for (const el of card.querySelectorAll("[data-job]")) {
        job[el.dataset.job] = el.type === "checkbox" ? el.checked : el.value.trim();
      }
      return job;
    })
    .filter((j) => j.title || j.company);
}

document.getElementById("addJob").onclick = () => addJob();

// Read jobs (and any missing contact info) from a resume. Shown for review; nothing is
// saved until you click Save.
document.getElementById("resume").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const note = document.getElementById("resumeStatus");
  note.textContent = "Reading…";
  try {
    const { textFromFile, parseResume } = await import("./resume.js");
    const { contact, jobs } = parseResume(await textFromFile(file));
    if (!jobs.length) {
      note.textContent = "Couldn't find any jobs with dates in that file. Add them by hand instead.";
      return;
    }
    const have = readJobs().length;
    if (have && !confirm(`Replace your ${have} saved job${have === 1 ? "" : "s"} with the ${jobs.length} found in your resume?`)) {
      note.textContent = "";
      return;
    }
    jobsBox.replaceChildren();
    jobs.forEach((j) => addJob(j));
    for (const [k, v] of Object.entries(contact)) if (v && form.elements[k] && !form.elements[k].value) form.elements[k].value = v;
    note.textContent = `Found ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Check them, then click Save.`;
  } catch (err) {
    console.error(err);
    note.textContent = "Couldn't read that file.";
  }
});

// ---------- load / save ----------
function fill(data) {
  for (const el of form.elements) if (el.name) el.value = data[el.name] ?? "";
  jobsBox.replaceChildren();
  for (const job of data.jobs || []) addJob(job);
}

function read() {
  const data = {};
  for (const el of form.elements) if (el.name) data[el.name] = el.value.trim();
  data.jobs = readJobs();
  return data;
}

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => (status.textContent = ""), 2500);
}

browser.storage.local.get("autofillData").then(({ autofillData }) => fill(autofillData || {}));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await browser.storage.local.set({ autofillData: read() });
  flash("Saved ✓");
});

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(read(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "apply-autofill-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Import overlays what's in the file onto the current settings, so a partial file
// (e.g. just work history) doesn't wipe everything else.
document.getElementById("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    fill({ ...read(), ...JSON.parse(await file.text()) });
    await browser.storage.local.set({ autofillData: read() });
    flash("Imported ✓");
  } catch {
    flash("That file isn't a valid backup.");
  }
  e.target.value = "";
});
