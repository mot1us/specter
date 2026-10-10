import { sampleTasks, categories } from './data.js';

const STORAGE_KEY = 'little-things.tasks.v1';
const THEME_KEY = 'little-things.theme.v1';
const $ = selector => document.querySelector(selector);
const freshTasks = () => sampleTasks.map(task => ({ ...task }));
let tasks = loadTasks();
let filter = 'all';
let search = '';
let toastTimer;
let storageAvailable = true;

function loadTasks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return freshTasks();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(task =>
      task && typeof task.id === 'string' && typeof task.title === 'string' &&
      task.title.trim().length > 0 && task.title.length <= 120 &&
      typeof task.done === 'boolean' && categories.includes(task.category)
    ) || new Set(parsed.map(task => task.id)).size !== parsed.length) return freshTasks();
    return parsed;
  } catch {
    return freshTasks();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
    announce('your browser could not save this board. changes last until refresh.');
  }
  $('#save-status').textContent = storageAvailable ? 'saved on this device' : 'changes kept for this visit';
}

function announce(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('is-visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('is-visible'), 3000);
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function taskRow(task) {
  const row = document.createElement('li');
  row.className = `task-row${task.done ? ' is-done' : ''}`;
  row.dataset.id = task.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'task-check';
  check.dataset.action = 'toggle';
  check.setAttribute('aria-label', `mark “${task.title}” ${task.done ? 'incomplete' : 'complete'}`);
  check.setAttribute('aria-pressed', String(task.done));
  check.append(icon('check'));

  const content = document.createElement('div');
  content.className = 'task-content';
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const category = document.createElement('span');
  category.className = 'category';
  category.dataset.category = task.category;
  category.textContent = task.category;
  meta.append(category);
  if (task.featured && !task.done) {
    const featured = document.createElement('span');
    featured.className = 'featured-label';
    featured.textContent = '✳ a good place to start';
    meta.append(featured);
  }
  content.append(title, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-task';
  remove.dataset.action = 'delete';
  remove.setAttribute('aria-label', `delete “${task.title}”`);
  remove.append(icon('trash'));
  row.append(check, content, remove);
  return row;
}

function render() {
  const completed = tasks.filter(task => task.done).length;
  const remaining = tasks.length - completed;
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const visible = tasks.filter(task =>
    (filter === 'all' || (filter === 'done' ? task.done : !task.done)) &&
    `${task.title} ${task.category}`.toLowerCase().includes(search)
  );

  $('#task-list').replaceChildren(...visible.map(taskRow));
  $('#total-count').textContent = tasks.length;
  $('#all-count').textContent = tasks.length;
  $('#open-count').textContent = remaining;
  $('#done-count').textContent = completed;
  $('#remaining-stat').textContent = remaining;
  $('#completed-stat').textContent = completed;
  $('#progress-percent').textContent = `${percent}%`;
  $('#progress-fill').style.width = `${percent}%`;
  $('#progress-bar').setAttribute('aria-valuenow', String(percent));
  $('#progress-caption').textContent = tasks.length && !remaining ? 'look at that. you did the little things.' : 'every little checkmark counts.';
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  });

  $('#empty-state').hidden = visible.length > 0;
  const empty = search
    ? ['no little things found.', 'try a different word or clear your search.']
    : filter === 'done'
      ? ['your first little win is waiting.', 'check off a task and it will show up here.']
      : filter === 'open' && tasks.length
        ? ['all done. take a little breather.', 'you’ve earned it. add something new when you’re ready.']
        : ['room for something good.', 'add your first task. keep it small.'];
  $('#empty-title').textContent = empty[0];
  $('#empty-copy').textContent = empty[1];
}

function closeComposer() {
  $('#task-form').hidden = true;
  $('#task-form').reset();
  $('#new-task').focus();
}

$('#new-task').addEventListener('click', () => {
  $('#task-form').hidden = false;
  $('#task-title').focus();
});
$('#cancel-task').addEventListener('click', closeComposer);
$('#task-form').addEventListener('keydown', event => {
  if (event.key === 'Escape') closeComposer();
});
$('#task-title').addEventListener('input', event => event.target.setCustomValidity(''));
$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get('title')).trim();
  if (!title) {
    $('#task-title').setCustomValidity('give your task a name first.');
    $('#task-title').reportValidity();
    return;
  }
  tasks.unshift({ id: crypto.randomUUID(), title, category: String(form.get('category')), done: false });
  filter = 'all';
  search = '';
  $('#search').value = '';
  persist();
  closeComposer();
  render();
  if (storageAvailable) announce('one small step, added.');
});

$('#task-list').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('[data-id]');
  const task = tasks.find(item => item.id === row.dataset.id);
  if (!task) return;
  const nextId = row.nextElementSibling?.dataset.id || row.previousElementSibling?.dataset.id;
  if (button.dataset.action === 'toggle') {
    task.done = !task.done;
  } else {
    tasks = tasks.filter(item => item.id !== task.id);
  }
  persist();
  render();
  const focusId = button.dataset.action === 'toggle' ? task.id : nextId;
  const focusRow = [...$('#task-list').children].find(item => item.dataset.id === focusId)
    || [...$('#task-list').children].find(item => item.dataset.id === nextId);
  (focusRow?.querySelector('.task-check') || $('#new-task')).focus({ preventScroll: true });
  if (storageAvailable) announce(button.dataset.action === 'delete' ? 'task removed. a little less on your plate.' : task.done ? 'a little win. nice work!' : 'back on the list. no rush.');
});

document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => { filter = button.dataset.filter; render(); });
});
$('#search').addEventListener('input', event => {
  search = event.target.value.trim().toLowerCase();
  render();
});

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-label', `switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#1c2622' : '#faf9f6';
}
try { setTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'); } catch { setTheme('light'); }
$('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Theme still works for this visit. */ }
});

$('#reset-demo').addEventListener('click', () => {
  if (!confirm('replace your current tasks with the sample board?')) return;
  tasks = freshTasks();
  filter = 'all';
  search = '';
  $('#search').value = '';
  closeComposer();
  persist();
  render();
  if (storageAvailable) announce('a fresh start. sample board restored.');
});
$('#test-guide').addEventListener('click', () => $('#guide-dialog').showModal());
$('#guide-dialog').addEventListener('click', event => {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
});

function updateDate() {
  const now = new Date();
  $('#weekday').textContent = now.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
  $('#date-label').textContent = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase();
}
updateDate();
setInterval(updateDate, 60_000);
persist();
render();
