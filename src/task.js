import { initStorage, storageGet, storageSet } from './store.js';

const taskListEl = document.getElementById('task-list');
const addInputEl = document.getElementById('add-input');
const addBtnEl = document.getElementById('add-btn');
const closeBtnEl = document.getElementById('close-btn');

let tasks = [];
let currentTask = '';
let currentDetail = '';
let expandedTaskName = null;

function normalizeTasks(raw) {
  return (Array.isArray(raw) ? raw : []).map((task) => {
    if (typeof task === 'string') {
      return { name: task, details: [] };
    }
    return {
      name: String(task?.name ?? '').trim(),
      details: Array.isArray(task?.details)
        ? task.details.map((detail) => String(detail).trim()).filter(Boolean)
        : [],
    };
  }).filter((task) => task.name);
}

function serializeTasks() {
  return tasks.map((task) => ({
    name: task.name,
    details: [...task.details],
  }));
}

function persistState({ broadcast = true, logPrevious = false } = {}) {
  storageSet('mt_tasks', serializeTasks());
  storageSet('mt_current_task', currentTask);
  storageSet('mt_current_detail', currentDetail);

  if (broadcast) {
    void window.__TAURI__?.event?.emitTo?.('main', 'task-state-changed', {
      task: currentTask,
      detail: currentDetail,
      tasks: serializeTasks(),
      logPrevious,
    });
  }
}

function ensureValidSelection() {
  const task = tasks.find((item) => item.name === currentTask);
  if (!task) {
    currentTask = '';
    currentDetail = '';
    expandedTaskName = null;
    return;
  }

  if (currentDetail && !task.details.includes(currentDetail)) {
    currentDetail = '';
  }
  expandedTaskName = currentTask;
}

function loadState() {
  tasks = normalizeTasks(storageGet('mt_tasks', []));
  currentTask = String(storageGet('mt_current_task', '') || '');
  currentDetail = String(storageGet('mt_current_detail', '') || '');
  ensureValidSelection();
  persistState({ broadcast: true, logPrevious: false });
}

function setSelection(taskName, detail = '') {
  currentTask = taskName;
  currentDetail = detail;
  expandedTaskName = taskName || null;
  persistState({ logPrevious: true });
  render();
  void window.__TAURI__?.window?.getCurrentWindow?.()?.hide?.();
}

function addTask() {
  const name = addInputEl.value.trim();
  if (!name || tasks.some((task) => task.name === name)) {
    addInputEl.value = '';
    return;
  }

  tasks.push({ name, details: [] });
  addInputEl.value = '';
  persistState({ logPrevious: false });
  render();
}

function addDetail(task, inputEl) {
  const name = inputEl.value.trim();
  if (!name || task.details.includes(name)) {
    inputEl.value = '';
    return;
  }

  task.details.push(name);
  inputEl.value = '';
  persistState({ logPrevious: false });
  render();
}

function deleteTask(taskName) {
  tasks = tasks.filter((task) => task.name !== taskName);
  if (currentTask === taskName) {
    currentTask = '';
    currentDetail = '';
  }
  if (expandedTaskName === taskName) {
    expandedTaskName = null;
  }
  persistState({ logPrevious: false });
  render();
}

function deleteDetail(task, detailName) {
  task.details = task.details.filter((detail) => detail !== detailName);
  if (currentTask === task.name && currentDetail === detailName) {
    currentDetail = '';
  }
  persistState({ logPrevious: false });
  render();
}

function toggleExpanded(taskName) {
  expandedTaskName = expandedTaskName === taskName ? null : taskName;
  render();
}

function renderNoneRow() {
  const row = document.createElement('div');
  row.className = `task-item${currentTask === '' ? ' active' : ''}`;

  const toggle = document.createElement('span');
  toggle.className = 'task-toggle';
  toggle.style.opacity = '0';
  toggle.textContent = '▸';

  const name = document.createElement('span');
  name.className = 'task-name-text';
  name.textContent = 'なし';

  row.appendChild(toggle);
  row.appendChild(name);
  row.addEventListener('click', () => setSelection('', ''));
  return row;
}

function renderTaskRow(task) {
  const isExpanded = expandedTaskName === task.name || (currentTask === task.name && currentDetail);
  const isActive = currentTask === task.name && currentDetail === '';

  const row = document.createElement('div');
  row.className = `task-item${isActive ? ' active' : ''}`;

  const toggle = document.createElement('span');
  toggle.className = 'task-toggle';
  toggle.textContent = isExpanded ? '▾' : '▸';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpanded(task.name);
  });

  const name = document.createElement('span');
  name.className = 'task-name-text';
  name.textContent = task.name;

  const del = document.createElement('span');
  del.className = 'task-del';
  del.textContent = '✕';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.name);
  });

  row.appendChild(toggle);
  row.appendChild(name);
  row.appendChild(del);
  row.addEventListener('click', () => setSelection(task.name, ''));

  const fragment = document.createDocumentFragment();
  fragment.appendChild(row);

  if (isExpanded) {
    task.details.forEach((detail) => {
      const detailRow = document.createElement('div');
      const isDetailActive = currentTask === task.name && currentDetail === detail;
      detailRow.className = `task-item detail-item${isDetailActive ? ' active' : ''}`;

      const indent = document.createElement('span');
      indent.className = 'detail-indent';
      indent.textContent = '└';

      const detailName = document.createElement('span');
      detailName.className = 'task-name-text';
      detailName.textContent = detail;

      const delDetail = document.createElement('span');
      delDetail.className = 'task-del';
      delDetail.textContent = '✕';
      delDetail.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteDetail(task, detail);
      });

      detailRow.appendChild(indent);
      detailRow.appendChild(detailName);
      detailRow.appendChild(delDetail);
      detailRow.addEventListener('click', () => setSelection(task.name, detail));
      fragment.appendChild(detailRow);
    });

    const addRow = document.createElement('div');
    addRow.className = 'detail-add-row';

    const indent = document.createElement('span');
    indent.className = 'detail-indent';
    indent.textContent = '└';

    const input = document.createElement('input');
    input.className = 'detail-add-input';
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = '詳細を追加...';

    const button = document.createElement('button');
    button.className = 'detail-add-btn';
    button.type = 'button';
    button.textContent = '＋';

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      addDetail(task, input);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        addDetail(task, input);
      }
      if (e.key === 'Escape') {
        input.value = '';
      }
    });
    addRow.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());

    addRow.appendChild(indent);
    addRow.appendChild(input);
    addRow.appendChild(button);
    fragment.appendChild(addRow);
  }

  return fragment;
}

function render() {
  taskListEl.innerHTML = '';
  taskListEl.appendChild(renderNoneRow());
  tasks.forEach((task) => {
    taskListEl.appendChild(renderTaskRow(task));
  });
}

closeBtnEl.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtnEl.addEventListener('click', () => {
  void window.__TAURI__?.window?.getCurrentWindow?.()?.hide?.();
});

addBtnEl.addEventListener('click', (e) => {
  e.stopPropagation();
  addTask();
});

addInputEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    addTask();
  }
  if (e.key === 'Escape') {
    addInputEl.value = '';
  }
});

addInputEl.addEventListener('mousedown', (e) => e.stopPropagation());
taskListEl.addEventListener('mousedown', (e) => e.stopPropagation());

(async () => {
  await initStorage();
  loadState();
  render();
  addInputEl.focus();

  // メインウィンドウのテーマに合わせる（起動時）
  try {
    const savedTheme = localStorage.getItem('mt_theme');
    if (savedTheme) document.body.className = savedTheme;
  } catch {}

  // テーマ変更をリアルタイムで追従
  void window.__TAURI__?.event?.listen?.('theme-changed', ({ payload }) => {
    document.body.className = payload?.theme ?? '';
  }, { target: 'task' });
})();

window.refreshTasks = () => {
  loadState();
  render();
};
