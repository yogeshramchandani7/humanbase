// Drives the two demo panels: fetch the run result, then reveal the trace step-by-step and the result card.

const STEP_MS = 750;
const short = (h) => (h && h.startsWith("0x") && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
const isReal = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

function hashChip(label, hash, explorer, linkable) {
  if (!hash) return "";
  const inner = `<span class="tag">${label}</span> <span class="hx">${hash}</span>`; // full hash, never truncated
  if (linkable && isReal(hash)) return `<a class="hashchip" href="${explorer}${hash}" target="_blank" rel="noopener">${inner} ↗</a>`;
  return `<span class="hashchip" title="on-chain tx (Base Sepolia fork)">${inner}</span>`;
}

// Step templates. {actor, text, state, hash?: 'payment'|'settle'|'refund'}
const STEPS = {
  found: (d) => [
    { actor: "AGENT", text: `Requests contact — <b>Tim Zheng</b> @ apollo.io`, state: "ok" },
    { actor: "AGENT", text: `402 Payment Required → authorizes <b>0.01 USDC</b> into x402r escrow`, state: "ok", hash: "payment" },
    { actor: "HUMANBASE", text: `Fetches from Apollo${d.merchant.live ? ` <span class="live-tag">LIVE</span>` : ` <span class="live-tag replay">replay</span>`}`, state: "ok" },
    { actor: "HUMANBASE", text: `Record found → mints <b>zkTLS delivery proof</b>`, state: "ok" },
    { actor: "X402R", text: `Verifies proof on-chain ✓ → <b>releases escrow</b> to humanbase`, state: "ok", hash: "settle" },
    { actor: "AGENT", text: `Receives verified contact data`, state: "ok" },
  ],
  notfound: (d) => [
    { actor: "AGENT", text: `Requests contact — <b>unknown person</b> @ no-such-company`, state: "ok" },
    { actor: "AGENT", text: `402 Payment Required → authorizes <b>0.01 USDC</b> into x402r escrow`, state: "ok", hash: "payment" },
    { actor: "HUMANBASE", text: `Queries Apollo${d.merchant.live ? ` <span class="live-tag">LIVE</span>` : ` <span class="live-tag replay">replay</span>`}`, state: "ok" },
    { actor: "HUMANBASE", text: `<b>No verified contact found</b> → cannot mint a delivery proof`, state: "fail" },
    { actor: "X402R", text: `No proof → escrow release <b>blocked</b>`, state: "ok" },
    { actor: "X402R", text: `<b>Refunds 0.01 USDC</b> to the agent`, state: "ok", hash: "refund" },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function renderResult(d) {
  if (d.case === "found") {
    const p = d.person || {};
    const org = p.organization || {};
    return `
      <span class="badge settled">● SETTLED — humanbase paid 0.01 USDC</span>
      <div class="card">
        <div class="who"><div><div class="nm">${p.name ?? "—"}</div><div class="ti">${p.title ?? ""} · ${org.name ?? ""}</div></div></div>
        <div class="rows">
          <div class="k">email</div><div class="v">${p.email ?? "—"} ${p.email_status ? "✓" : ""}</div>
          <div class="k">company</div><div class="v">${org.domain ?? "—"}</div>
          <div class="k">location</div><div class="v">${[p.city, p.state, p.country].filter(Boolean).join(", ") || "—"}</div>
        </div>
        <div class="proofline">🔐 zkTLS proof verified
          <span class="vrf">verifier ${d.proof?.verifier}</span>
          <span class="vrf">proof id ${d.proof?.identifier}</span>
        </div>
      </div>`;
  }
  return `
    <span class="badge refunded">● REFUNDED — agent's money returned by x402r</span>
    <div class="miss">No verified contact found.
      <div class="sub">humanbase could not produce a delivery proof, so the escrow never released — x402r returned the agent's 0.01 USDC.</div>
    </div>`;
}

async function run(kase) {
  const btn = document.querySelector(`[data-run="${kase}"]`);
  const traceEl = document.getElementById(`trace-${kase}`);
  const resultEl = document.getElementById(`result-${kase}`);
  btn.disabled = true;
  traceEl.innerHTML = "";
  resultEl.className = "result";
  resultEl.innerHTML = "";

  let d;
  try {
    d = await (await fetch(`/api/run/${kase}`)).json();
  } catch (e) {
    traceEl.innerHTML = `<li class="step show fail"><span class="ic">!</span><span class="body">demo server unreachable</span></li>`;
    btn.disabled = false;
    return;
  }

  const steps = STEPS[kase](d);
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = `step ${s.state}`;
    const hash = s.hash ? d.hashes?.[s.hash] : null;
    const label = s.hash === "payment" ? "escrow payment" : s.hash === "settle" ? "settlement" : s.hash === "refund" ? "refund" : "";
    li.innerHTML = `
      <span class="ic">${s.state === "fail" ? "✕" : "✓"}</span>
      <span class="body"><span class="actor actor-${s.actor}">${s.actor}</span>${s.text}
        ${hash ? `<div>${hashChip(label, hash, d.explorer, d.explorerLinkable)}</div>` : ""}</span>`;
    traceEl.appendChild(li);
    await sleep(60);
    li.classList.add("show");
    await sleep(STEP_MS);
  }

  resultEl.innerHTML = renderResult(d);
  resultEl.classList.add("show");
  btn.disabled = false;
}

document.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => run(b.dataset.run)));
