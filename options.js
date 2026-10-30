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
