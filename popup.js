const $ = id => document.getElementById(id);
const circumference = 2 * Math.PI * 37;

function diffColor(d) {
  return d === 'Easy' ? '#22c55e' : d === 'Medium' ? '#f59e0b' : '#ef4444';
}

async function render() {
  const { progress = {} } = await chrome.storage.local.get('progress');
  const { githubToken } = await chrome.storage.sync.get(['githubToken']);

  $('banner').style.display = githubToken ? 'none' : 'block';

  const solved = new Set(
    Object.values(progress).filter(p => p.inNeetCode && p.solved).map(p => p.slug)
  );

  const done = NEETCODE_150.filter(p => solved.has(p.slug)).length;
  const pct = Math.round((done / 150) * 100);
  const easy = NEETCODE_150.filter(p => solved.has(p.slug) && p.difficulty === 'Easy').length;
  const med = NEETCODE_150.filter(p => solved.has(p.slug) && p.difficulty === 'Medium').length;
  const hard = NEETCODE_150.filter(p => solved.has(p.slug) && p.difficulty === 'Hard').length;

  $('doneCount').textContent = done;
  $('pctLabel').textContent = `${pct}% complete`;
  $('ringFg').style.strokeDashoffset = circumference - (pct / 100) * circumference;

  $('easyCount').textContent = easy;
  $('medCount').textContent = med;
  $('hardCount').textContent = hard;

  // Topics
  const topicList = $('topicList');
  topicList.innerHTML = '';
  TOPICS.forEach(topic => {
    const total = TOPIC_COUNTS[topic];
    const topicDone = NEETCODE_150.filter(p => p.topic === topic && solved.has(p.slug)).length;
    const topicPct = total > 0 ? Math.round((topicDone / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'topic-row';
    row.innerHTML = `
      <span class="topic-name">${topic}</span>
      <div class="topic-bar-wrap">
        <div class="topic-bar-fill" style="width:${topicPct}%"></div>
      </div>
      <span class="topic-count">${topicDone}/${total}</span>
    `;
    topicList.appendChild(row);
  });

  // Recent 5
  const recentList = $('recentList');
  recentList.innerHTML = '';
  const recent = Object.values(progress)
    .filter(p => p.inNeetCode && p.solved)
    .sort((a, b) => new Date(b.solvedAt) - new Date(a.solvedAt))
    .slice(0, 5);

  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty">No problems solved yet.<br>Go solve something! 🚀</div>';
  } else {
    recent.forEach(p => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.innerHTML = `
        <div class="recent-dot" style="background:${diffColor(p.difficulty)}"></div>
        <div>
          <div class="recent-title">${p.title}</div>
          <div class="recent-topic">${p.topic}</div>
        </div>
      `;
      recentList.appendChild(item);
    });
  }
}

$('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('bannerLink')?.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

// Re-render automatically if progress changes while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.progress) render();
  if (area === 'sync' && changes.githubToken) render();
});

render();
