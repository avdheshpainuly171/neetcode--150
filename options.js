const $ = id => document.getElementById(id);

async function load() {
  const { githubUser = '', githubRepo = '', githubToken = '' } =
    await chrome.storage.sync.get(['githubUser', 'githubRepo', 'githubToken']);
  $('githubUser').value = githubUser;
  $('githubRepo').value = githubRepo;
  $('githubToken').value = githubToken;
}

function setStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
  if (msg) setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
}

$('saveBtn').addEventListener('click', async () => {
  const githubUser = $('githubUser').value.trim();
  const githubRepo = $('githubRepo').value.trim();
  const githubToken = $('githubToken').value.trim();

  if (!githubUser || !githubRepo || !githubToken) {
    setStatus('Please fill in all three fields.', false);
    return;
  }

  await chrome.storage.sync.set({ githubUser, githubRepo, githubToken });
  setStatus('Saved ✅ — solve a problem to test it!', true);
});

load();
