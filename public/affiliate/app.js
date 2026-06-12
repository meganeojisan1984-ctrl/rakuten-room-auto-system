/* X高単価アフィリ送客システム フロントエンド（スマホ/タブレット対応） */
const $ = (id) => document.getElementById(id);
let pollTimer = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ── 起動時: 環境状態 & 案件候補 ──
async function init() {
  try {
    const h = await api('/api/affiliate/health');
    $('statusDot').className = 'status-dot ' + (h.llm ? 'ok' : 'ng');
    $('statusText').textContent = h.llm ? 'AI接続OK' : 'GROQ_API_KEY未設定';
    $('envInfo').textContent =
      `LLM(Groq): ${h.llm ? '✓' : '✗'} ／ Googleスプレッドシート: ${h.sheets ? '✓' : '✗（ローカル出力）'}`;
  } catch (e) {
    $('statusText').textContent = '接続エラー';
  }
  try {
    const f = await api('/api/affiliate/funnel');
    $('funnelType').value = f.type || 'line';
    $('funnelLine').value = f.lineUrl || '';
    $('funnelMagnet').value = f.leadMagnet || '';
    $('funnelBlog').value = f.blogUrl || '';
    $('funnelBrand').value = f.brand || '';
  } catch (_) {}
  try {
    const offers = await api('/api/affiliate/offers');
    const dl = $('offerList');
    dl.innerHTML = '';
    Object.values(offers).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.name;
      dl.appendChild(opt);
    });
  } catch (_) {}
}

// ── 詳細入力から Offer を組み立て ──
function collectOfferFields() {
  const name = $('offerInput').value.trim();
  const f = {
    name,
    genre: $('f_genre').value.trim() || undefined,
    price: $('f_price').value.trim() || undefined,
    reward: $('f_reward').value.trim() || undefined,
    consultContent: $('f_consult').value.trim() || undefined,
    consultBenefits: $('f_benefits').value.trim() || undefined,
    followers: $('f_followers').value ? Number($('f_followers').value) : undefined,
    goalLeads: $('f_goalLeads').value ? Number($('f_goalLeads').value) : undefined,
    goalRevenue: $('f_goalRevenue').value.trim() || undefined,
  };
  Object.keys(f).forEach((k) => f[k] === undefined && delete f[k]);
  return f;
}

// ── 誘導先設定保存 ──
$('saveFunnelBtn').addEventListener('click', async () => {
  try {
    await api('/api/affiliate/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: $('funnelType').value,
        lineUrl: $('funnelLine').value.trim(),
        leadMagnet: $('funnelMagnet').value.trim(),
        blogUrl: $('funnelBlog').value.trim(),
        brand: $('funnelBrand').value.trim(),
      }),
    });
    alert('誘導先設定を保存しました');
  } catch (e) { alert('保存失敗: ' + e.message); }
});

// ── 案件保存 ──
$('saveOfferBtn').addEventListener('click', async () => {
  const offer = collectOfferFields();
  if (!offer.name) { alert('案件名を入力してください'); return; }
  try {
    await api('/api/affiliate/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offer),
    });
    alert('案件情報を保存しました');
    init();
  } catch (e) { alert('保存失敗: ' + e.message); }
});

// ── 生成開始 ──
$('runBtn').addEventListener('click', async () => {
  const offer = collectOfferFields();
  if (!offer.name) { alert('案件名を入力してください'); return; }

  // 詳細が入力されていれば先に保存（◯◯を案件に合わせて変動させる）
  if (Object.keys(offer).length > 1) {
    try {
      await api('/api/affiliate/offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(offer),
      });
    } catch (_) {}
  }

  $('runBtn').disabled = true;
  $('progressCard').style.display = 'block';
  $('resultCard').style.display = 'none';
  $('progressStatus').className = 'badge';
  $('progressStatus').textContent = '実行中…';
  $('progressLog').innerHTML = '';

  try {
    const { jobId } = await api('/api/affiliate/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: offer.name }),
    });
    poll(jobId);
  } catch (e) {
    $('runBtn').disabled = false;
    $('progressStatus').className = 'badge error';
    $('progressStatus').textContent = '開始失敗: ' + e.message;
  }
});

// ── 進捗ポーリング ──
function poll(jobId) {
  clearInterval(pollTimer);
  let lastLen = 0;
  pollTimer = setInterval(async () => {
    let job;
    try { job = await api('/api/affiliate/jobs/' + jobId); }
    catch (_) { return; }

    if (job.progress.length > lastLen) {
      const ul = $('progressLog');
      for (let i = lastLen; i < job.progress.length; i++) {
        const p = job.progress[i];
        const li = document.createElement('li');
        li.innerHTML = `<span class="t">${p.at}</span><b>${p.step}</b> ${p.detail}`;
        ul.appendChild(li);
        ul.scrollTop = ul.scrollHeight;
      }
      lastLen = job.progress.length;
    }

    if (job.status === 'done') {
      clearInterval(pollTimer);
      $('runBtn').disabled = false;
      $('progressStatus').className = 'badge done';
      $('progressStatus').textContent = '完了';
      showResult(job.result);
    } else if (job.status === 'error') {
      clearInterval(pollTimer);
      $('runBtn').disabled = false;
      $('progressStatus').className = 'badge error';
      $('progressStatus').textContent = 'エラー: ' + (job.error || '不明');
    }
  }, 2000);
}

// ── 結果表示 ──
function showResult(r) {
  $('resultCard').style.display = 'block';
  const dest = r.destination === 'google-sheets'
    ? `スプレッドシートのタブ「${r.tab}」に書き込みました。`
    : `ローカル出力しました（${r.localPath}）。Googleスプレッドシート連携を設定すると自動でタブに書き込まれます。`;
  $('resultBody').innerHTML = `
    <div class="scorebox">
      <div class="score"><div class="n">${r.credibility}</div><div class="l">信憑性</div></div>
      <div class="score"><div class="n">${r.completeness}</div><div class="l">完成度</div></div>
    </div>
    <p>${dest}</p>
    <div class="summary"><b>指揮官 総合所見</b>\n${r.summary || ''}</div>`;
  if (r.url) {
    const link = $('sheetLink');
    link.href = r.url;
    link.style.display = 'block';
  } else {
    $('sheetLink').style.display = 'none';
  }
}

init();
