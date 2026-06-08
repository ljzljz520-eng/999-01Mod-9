const API_BASE = 'http://localhost:8080/api';

class UIManager {
    constructor() {
        this.overlay = document.getElementById('globalOverlay');
        this.confirmModal = document.getElementById('confirmModal');
        this.confirmTitle = document.getElementById('confirmTitle');
        this.confirmMessage = document.getElementById('confirmMessage');
        this.confirmOkBtn = document.getElementById('confirmOkBtn');
        this.confirmCancelBtn = document.getElementById('confirmCancelBtn');
        this.alertModal = document.getElementById('alertModal');
        this.alertMessage = document.getElementById('alertMessage');
        this.alertOkBtn = document.getElementById('alertOkBtn');
        this.init();
    }

    init() {
        if (this.confirmCancelBtn) {
            this.confirmCancelBtn.addEventListener('click', () => this.hideConfirm());
        }
        if (this.alertOkBtn) {
            this.alertOkBtn.addEventListener('click', () => this.hideAlert());
        }
    }

    showOverlay() {
        if (this.overlay) this.overlay.classList.remove('hidden');
    }

    hideOverlay() {
        if (this.confirmModal.classList.contains('hidden') &&
            this.alertModal.classList.contains('hidden') &&
            document.getElementById('settingsModal').classList.contains('hidden') &&
            document.getElementById('loginModal').classList.contains('hidden') &&
            document.getElementById('exportModal').classList.contains('hidden') &&
            document.getElementById('approvalModal').classList.contains('hidden')) {
            if (this.overlay) this.overlay.classList.add('hidden');
        }
    }

    confirm(message, onConfirm, title = '确认操作') {
        if (!this.confirmModal) return;
        this.confirmTitle.textContent = title;
        this.confirmMessage.textContent = message;
        const newOkBtn = this.confirmOkBtn.cloneNode(true);
        this.confirmOkBtn.parentNode.replaceChild(newOkBtn, this.confirmOkBtn);
        this.confirmOkBtn = newOkBtn;
        this.confirmOkBtn.addEventListener('click', () => {
            this.hideConfirm();
            if (onConfirm) onConfirm();
        });
        this.showOverlay();
        this.confirmModal.classList.remove('hidden');
    }

    hideConfirm() {
        if (this.confirmModal) this.confirmModal.classList.add('hidden');
        this.hideOverlay();
    }

    alert(message, title = '提示') {
        if (!this.alertModal) return;
        document.getElementById('alertTitle').textContent = title;
        this.alertMessage.textContent = message;
        this.showOverlay();
        this.alertModal.classList.remove('hidden');
    }

    hideAlert() {
        if (this.alertModal) this.alertModal.classList.add('hidden');
        this.hideOverlay();
    }
}

class ConnectionManager {
    constructor() {
        this.connectionsKey = 'fa_query_connections_v5';
        this.activeIdKey = 'fa_query_active_connection_id_v5';
        this.modal = document.getElementById('settingsModal');
        this.openBtn = document.getElementById('settingsBtn');
        this.closeBtn = document.getElementById('closeSettings');
        this.init();
    }

    init() {
        this.ensureDefaultConnection();
        if (this.openBtn) this.openBtn.addEventListener('click', () => this.openConnectionsModal());
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.closeModal());
    }

    ensureDefaultConnection() {
        const connections = this.getConnections();
        if (!connections.find(c => c.id === 'default-mysql')) {
            const defaultConn = {
                id: 'default-mysql',
                name: '系统默认数据库 (MySQL)',
                type: 'default',
                isDefault: true,
                canDelete: false,
                createdAt: new Date().toISOString()
            };
            connections.unshift(defaultConn);
            this.saveConnections(connections);
        }
        if (!this.getActiveConnectionId()) {
            this.setActiveConnection('default-mysql');
        }
    }

    getConnections() {
        const stored = localStorage.getItem(this.connectionsKey);
        return stored ? JSON.parse(stored) : [];
    }

    saveConnections(connections) {
        localStorage.setItem(this.connectionsKey, JSON.stringify(connections));
    }

    getActiveConnectionId() {
        return localStorage.getItem(this.activeIdKey);
    }

    setActiveConnection(id) {
        localStorage.setItem(this.activeIdKey, id);
    }

    getActiveConnection() {
        const id = this.getActiveConnectionId();
        const connections = this.getConnections();
        return connections.find(c => c.id === id) || connections[0];
    }

    addConnection(config) {
        const connections = this.getConnections();
        const newConn = {
            id: 'conn-' + Date.now(),
            name: config.name || '新连接',
            type: 'mysql',
            isDefault: false,
            canDelete: true,
            createdAt: new Date().toISOString(),
            ...config
        };
        connections.push(newConn);
        this.saveConnections(connections);
        return newConn;
    }

    updateConnection(id, config) {
        const connections = this.getConnections();
        const index = connections.findIndex(c => c.id === id);
        if (index !== -1) {
            connections[index] = { ...connections[index], ...config };
            this.saveConnections(connections);
        }
    }

    deleteConnection(id) {
        uiManager.confirm('确定要删除这个连接配置吗？不可恢复。', () => {
            let connections = this.getConnections();
            const conn = connections.find(c => c.id === id);
            if (conn && !conn.canDelete) {
                uiManager.alert('系统默认连接不能删除');
                return;
            }
            connections = connections.filter(c => c.id !== id);
            this.saveConnections(connections);
            if (this.getActiveConnectionId() === id) {
                this.setActiveConnection('default-mysql');
            }
            this.renderConnectionsList();
        }, '删除连接');
    }

    parseConnectionString(connStr) {
        try {
            const mysqlMatch = connStr.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
            if (mysqlMatch) {
                return {
                    type: 'mysql',
                    user: decodeURIComponent(mysqlMatch[1]),
                    pass: decodeURIComponent(mysqlMatch[2]),
                    host: mysqlMatch[3],
                    port: mysqlMatch[4],
                    dbname: mysqlMatch[5]
                };
            }
            throw new Error('仅支持 MySQL 连接字符串 (mysql://user:pass@host:port/dbname)');
        } catch (e) {
            throw new Error('连接字符串解析失败：' + e.message);
        }
    }

    getHeaders() {
        const conn = this.getActiveConnection();
        if (!conn || conn.type === 'default') {
            return {};
        }
        if (conn.type === 'mysql') {
            return {
                'X-DB-CONNECTION': 'mysql',
                'X-DB-HOST': conn.host || '',
                'X-DB-PORT': conn.port || '3306',
                'X-DB-NAME': conn.dbname || '',
                'X-DB-USER': conn.user || '',
                'X-DB-PASSWORD': conn.pass || ''
            };
        }
        return {};
    }

    getCurrentConnectionName() {
        const conn = this.getActiveConnection();
        return conn ? conn.name : '未知连接';
    }

    openConnectionsModal() {
        this.renderConnectionsList();
        if (this.modal) {
            this.modal.classList.remove('hidden');
            uiManager.showOverlay();
        }
    }

    closeModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
            uiManager.hideOverlay();
        }
    }

    renderConnectionsList() {
        const connections = this.getConnections();
        const activeId = this.getActiveConnectionId();
        let html = `
            <div class="mb-6">
                <button onclick="window.connectionManager.showConnectionForm()" 
                    class="w-full py-3 px-4 bg-indigo-50 border-2 border-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-100 hover:border-indigo-200 transition-all font-semibold flex items-center justify-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    新增 MySQL 连接
                </button>
            </div>
            <div class="space-y-3">
        `;
        connections.forEach(conn => {
            const isActive = conn.id === activeId;
            const activeClass = isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/50' : 'border border-gray-100 hover:bg-gray-50';
            const isDefault = conn.type === 'default';
            html += `
                <div class="rounded-lg p-4 transition-all duration-200 ${activeClass}">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center gap-3 mb-1">
                                <span class="text-base font-bold text-gray-800">${conn.name}</span>
                                ${isActive ? '<span class="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">当前使用</span>' : ''}
                            </div>
                            <div class="text-sm text-gray-500 flex items-center gap-2">
                                <span class="uppercase font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs ">${isDefault ? 'SYSTEM' : 'MYSQL'}</span>
                                ${!isDefault ? `<span class="truncate max-w-[200px]">${conn.host}:${conn.port}</span>` : '<span class="text-gray-400 italic">内置容器数据库</span>'}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${!isActive ? `<button onclick="window.connectionManager.handleSetActive('${conn.id}')" class="px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition">启用</button>` : ''}
                            ${!isDefault ? `
                            <button onclick="window.connectionManager.showConnectionForm('${conn.id}')" class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition" title="编辑">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            </button>
                            <button onclick="window.connectionManager.deleteConnection('${conn.id}')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition" title="删除">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                            ` : '<div class="px-2 py-1 text-xs text-gray-400 bg-gray-100 rounded">系统预设</div>'}
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        const modalBody = this.modal.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;
    }

    handleSetActive(id) {
        this.setActiveConnection(id);
        this.renderConnectionsList();
    }

    showConnectionForm(editId = null) {
        const connections = this.getConnections();
        const conn = editId ? connections.find(c => c.id === editId) : null;
        const isEdit = !!conn;
        const html = `
            <form id="connectionForm" class="space-y-5" novalidate>
                <div class="flex items-center gap-2 text-gray-500 mb-2 cursor-pointer hover:text-gray-800 transition-colors w-max" onclick="window.connectionManager.renderConnectionsList()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                    <span class="text-sm font-medium">返回连接列表</span>
                </div>
                <div class="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-md">
                    <div class="flex">
                        <div class="flex-shrink-0">
                            <svg class="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div class="ml-3">
                            <p class="text-sm text-amber-700">
                                <strong>注意：</strong>新增连接需配置 <span class="font-bold underline">Public (公网) 可访问的生产环境数据库</span>。配置错误可能导致无法连接，建议仅限高级技术人员尝试。
                            </p>
                        </div>
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">连接名称</label>
                    <input type="text" id="connName" value="${conn ? conn.name : ''}" placeholder="例如：生产环境 MySQL" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow">
                </div>
                <input type="hidden" id="connType" value="mysql">
                <div class="bg-blue-50/50 rounded-lg p-4 border border-blue-100">
                    <label class="block text-xs font-bold text-blue-700 uppercase mb-2">快速填充</label>
                    <div class="flex gap-2">
                        <input type="text" id="connString" placeholder="mysql://user:pass@host:port/dbname" class="flex-1 px-3 py-1.5 text-sm border border-blue-200 rounded placeholder-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
                        <button type="button" onclick="window.connectionManager.parseAndFillForm()" class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 transition">解析</button>
                    </div>
                </div>
                <div id="mysqlFields" class="space-y-4 animate-fade-in">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">主机地址</label>
                            <input type="text" id="connHost" value="${conn && conn.host || ''}" placeholder="127.0.0.1" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">端口</label>
                            <input type="text" id="connPort" value="${conn && conn.port || '3306'}" placeholder="3306" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                            <input type="text" id="connUser" value="${conn && conn.user || ''}" placeholder="root" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
                            <input type="password" id="connPass" value="${conn && conn.pass || ''}" placeholder="密码" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">数据库名</label>
                        <input type="text" id="connDbname" value="${conn && conn.dbname || ''}" placeholder="fixed_assets" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                    </div>
                </div>
                <div class="flex gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onclick="window.connectionManager.renderConnectionsList()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">取消</button>
                    <button type="button" onclick="window.connectionManager.saveConnectionFromForm('${editId || ''}')" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-bold shadow-sm">${isEdit ? '保存修改' : '创建连接'}</button>
                </div>
            </form>
        `;
        const modalBody = this.modal.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;
        const form = document.getElementById('connectionForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveConnectionFromForm(editId);
            });
        }
    }

    parseAndFillForm() {
        const connString = document.getElementById('connString').value.trim();
        if (!connString) {
            uiManager.alert('请输入连接字符串');
            return;
        }
        try {
            const parsed = this.parseConnectionString(connString);
            if (parsed.type === 'mysql') {
                document.getElementById('connHost').value = parsed.host || '';
                document.getElementById('connPort').value = parsed.port || '3306';
                document.getElementById('connDbname').value = parsed.dbname || '';
                document.getElementById('connUser').value = parsed.user || '';
                document.getElementById('connPass').value = parsed.pass || '';
            }
            uiManager.alert('解析成功，表单已自动填充', '操作成功');
        } catch (e) {
            uiManager.alert(e.message, '解析错误');
        }
    }

    translateError(errorMsg) {
        if (!errorMsg) return '未知错误';
        if (errorMsg.includes('Access denied')) return '数据库访问被拒绝：用户名或密码错误';
        if (errorMsg.includes('Unknown database')) return '数据库不存在：请检查数据库名称';
        if (errorMsg.includes('Connection refused')) return '连接被拒绝：请检查主机地址和端口';
        if (errorMsg.includes('timed out')) return '连接超时：服务器无响应';
        if (errorMsg.includes('getaddrinfo failed')) return '主机名解析失败：请检查主机地址';
        return errorMsg;
    }

    saveConnectionFromForm(editId) {
        const name = document.getElementById('connName').value.trim();
        const type = 'mysql';
        if (!name) {
            uiManager.alert('请输入连接名称', '校验失败');
            return;
        }
        const config = { name, type };
        config.host = document.getElementById('connHost').value.trim();
        config.port = document.getElementById('connPort').value.trim();
        config.dbname = document.getElementById('connDbname').value.trim();
        config.user = document.getElementById('connUser').value.trim();
        config.pass = document.getElementById('connPass').value.trim();
        if (!config.host) {
            uiManager.alert('请输入主机地址 (IP 或域名)', '校验失败');
            return;
        }
        if (!config.port) {
            uiManager.alert('请输入端口号', '校验失败');
            return;
        }
        const portNum = parseInt(config.port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            uiManager.alert('端口号必须是 1 到 65535 之间的数字', '校验失败');
            return;
        }
        if (!config.user) {
            uiManager.alert('请输入数据库用户名', '校验失败');
            return;
        }
        if (!config.dbname) {
            uiManager.alert('请输入数据库名称', '校验失败');
            return;
        }
        if (editId) {
            this.updateConnection(editId, config);
            uiManager.alert('连接配置已更新', '操作成功');
        } else {
            this.addConnection(config);
            uiManager.alert('新连接已创建', '操作成功');
        }
        this.renderConnectionsList();
    }
}

class HistoryManager {
    constructor() {
        this.storageKey = 'fa_query_history_v5';
        this.maxItems = 20;
        this.listEl = document.getElementById('historyList');
        this.emptyEl = document.getElementById('emptyHistory');
        this.clearBtn = document.getElementById('clearHistoryBtn');
        this.init();
    }

    init() {
        this.render();
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => {
                uiManager.confirm('确定要清空所有历史记录吗？不可恢复。', () => {
                    this.clear();
                }, '清空历史');
            });
        }
        if (this.listEl) {
            this.listEl.addEventListener('click', (e) => {
                const item = e.target.closest('.history-item');
                if (!item) return;
                if (e.target.closest('.delete-btn')) {
                    e.stopPropagation();
                    const timestamp = parseInt(item.dataset.timestamp);
                    uiManager.confirm('确定要删除这条历史记录吗？', () => {
                        this.remove(timestamp);
                    }, '删除记录');
                    return;
                }
                const facode = item.dataset.facode;
                const ip = item.dataset.ip;
                const facodeInput = document.getElementById('facodeInput');
                const ipInput = document.getElementById('ipInput');
                const form = document.getElementById('queryForm');
                if (facodeInput && ipInput && form) {
                    facodeInput.value = facode;
                    ipInput.value = ip;
                    queryManager.performQuery();
                }
            });
        }
    }

    getHistory() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    add(record) {
        const history = this.getHistory();
        record.timestamp = Date.now();
        record.connectionName = connectionManager.getCurrentConnectionName();
        history.unshift(record);
        if (history.length > this.maxItems) history.pop();
        localStorage.setItem(this.storageKey, JSON.stringify(history));
        this.render();
    }

    remove(timestamp) {
        let history = this.getHistory();
        history = history.filter(h => h.timestamp !== timestamp);
        localStorage.setItem(this.storageKey, JSON.stringify(history));
        this.render();
    }

    clear() {
        localStorage.removeItem(this.storageKey);
        this.render();
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }

    render() {
        const history = this.getHistory();
        if (!this.listEl || !this.emptyEl) return;
        if (history.length === 0) {
            this.listEl.innerHTML = '';
            this.emptyEl.classList.remove('hidden');
            return;
        }
        this.emptyEl.classList.add('hidden');
        this.listEl.innerHTML = history.map(h => `
            <div class="history-item bg-white border border-gray-100 rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer group"
                 data-facode="${h.facode}" data-ip="${h.ip}" data-timestamp="${h.timestamp}">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-bold text-gray-800 text-lg">${h.facode}</span>
                            <span class="px-2 py-0.5 ${h.sn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'} text-xs font-bold rounded-full uppercase tracking-wide">
                                ${h.sn ? '已找到' : '未找到'}
                            </span>
                        </div>
                        ${h.sn ? `<div class="text-sm font-mono text-gray-600 mb-2">SN: ${h.sn}</div>` : ''}
                        <div class="flex items-center text-xs text-gray-400 gap-2">
                            <span>${this.formatTime(h.timestamp)}</span>
                            ${h.connectionName ? `<span class="bg-gray-50 px-1 rounded text-gray-500">${h.connectionName}</span>` : ''}
                        </div>
                    </div>
                    <button class="delete-btn text-gray-300 hover:text-red-500 hover:bg-red-50 p-2 rounded transition-all opacity-0 group-hover:opacity-100" title="删除">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `).join('');
    }
}

class QueryManager {
    constructor() {
        this.form = document.getElementById('queryForm');
        this.resultBox = document.getElementById('resultBox');
        this.errorBox = document.getElementById('errorBox');
        this.loadingEl = document.getElementById('loading');
        this.curlCommand = document.getElementById('curlCommand');
        this.init();
    }

    init() {
        if (this.form) {
            this.form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performQuery();
            });
            const facodeInput = document.getElementById('facodeInput');
            const ipInput = document.getElementById('ipInput');
            if (facodeInput) facodeInput.addEventListener('input', () => this.updateCurlCommand());
            if (ipInput) ipInput.addEventListener('input', () => this.updateCurlCommand());
        }
        this.updateCurlCommand();
    }

    updateCurlCommand() {
        const facode = document.getElementById('facodeInput')?.value || 'FA001';
        const ip = document.getElementById('ipInput')?.value || 'localhost';
        const headers = connectionManager.getHeaders();
        let curlCmd = `curl "http://${ip}:8080/api/query.php?facode=${facode}"`;
        Object.entries(headers).forEach(([key, value]) => {
            if (value) curlCmd += ` \\\n  -H "${key}: ${value}"`;
        });
        if (this.curlCommand) this.curlCommand.textContent = curlCmd;
    }

    async performQuery() {
        const facode = document.getElementById('facodeInput')?.value.trim();
        const ip = document.getElementById('ipInput')?.value.trim() || 'localhost';
        if (!ip) {
            uiManager.alert('请输入服务器 IP 地址或域名', '缺少参数');
            return;
        }
        if (!facode) {
            uiManager.alert('请输入固定资产编码', '参数错误');
            return;
        }
        this.showLoading();
        this.hideError();
        this.hideResult();
        try {
            const headers = connectionManager.getHeaders();
            const url = `http://${ip}:8080/api/query.php?facode=${encodeURIComponent(facode)}`;
            const response = await fetch(url, { method: 'GET', headers: headers });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const rawError = errorData.error || `HTTP 错误！状态码: ${response.status}`;
                const translatedError = connectionManager.translateError ? connectionManager.translateError(rawError) : rawError;
                throw new Error(translatedError);
            }
            const data = await response.json();
            if (data.success && data.data) {
                this.showResult(data.data);
                historyManager.add({ facode, ip, sn: data.data.sn });
            } else if (data.success && !data.data) {
                this.showError('未找到该固定资产编码对应的序列号');
                historyManager.add({ facode, ip, sn: null });
            } else {
                const rawError = data.error || '查询失败';
                const translatedError = connectionManager.translateError ? connectionManager.translateError(rawError) : rawError;
                throw new Error(translatedError);
            }
        } catch (error) {
            let errorMsg = '查询出错：';
            if (error.message.includes('Failed to fetch')) {
                errorMsg += '无法连接到服务器，请检查 IP 和后端状态';
            } else {
                errorMsg += error.message;
            }
            this.showError(errorMsg);
        } finally {
            this.hideLoading();
        }
    }

    showLoading() {
        if (this.loadingEl) this.loadingEl.classList.remove('hidden');
    }

    hideLoading() {
        if (this.loadingEl) this.loadingEl.classList.add('hidden');
    }

    showResult(data) {
        if (!this.resultBox) return;
        const resultContent = document.getElementById('resultContent');
        if (resultContent) {
            let fieldsHtml = '';
            if (data.asset_name) fieldsHtml += `<div><div class="text-xs text-gray-500 uppercase font-semibold mb-1">资产名称</div><div class="text-lg font-semibold text-gray-700">${data.asset_name}</div></div>`;
            if (data.user_name) fieldsHtml += `<div><div class="text-xs text-gray-500 uppercase font-semibold mb-1">使用人</div><div class="text-lg font-semibold text-gray-700">${data.user_name}</div></div>`;
            if (data.department) fieldsHtml += `<div><div class="text-xs text-gray-500 uppercase font-semibold mb-1">所属部门</div><div class="text-lg font-semibold text-gray-700">${data.department}</div></div>`;
            if (data.purchase_price) fieldsHtml += `<div><div class="text-xs text-gray-500 uppercase font-semibold mb-1">采购价格</div><div class="text-lg font-semibold text-red-600">¥ ${Number(data.purchase_price).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div></div>`;
            
            resultContent.innerHTML = `
                <div class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-6 border border-emerald-100 shadow-sm animate-fade-in">
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-sm font-bold text-emerald-600 uppercase tracking-widest">查询结果</span>
                        <span class="bg-emerald-200 text-emerald-800 text-xs px-2 py-1 rounded-full font-bold">成功</span>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <div class="text-xs text-gray-500 uppercase font-semibold mb-1">固定资产编码</div>
                            <div class="text-2xl font-bold text-gray-800 font-mono">${data.facode}</div>
                        </div>
                        <div class="h-px bg-emerald-200"></div>
                        <div>
                            <div class="text-xs text-gray-500 uppercase font-semibold mb-1">序列号 (SN)</div>
                            <div class="text-3xl font-extrabold text-emerald-600 font-mono tracking-wide selection:bg-emerald-200">${data.sn}</div>
                        </div>
                        ${fieldsHtml ? `<div class="h-px bg-emerald-200"></div><div class="grid grid-cols-2 gap-4">${fieldsHtml}</div>` : ''}
                    </div>
                </div>
            `;
        }
        this.resultBox.classList.remove('hidden');
    }

    hideResult() {
        if (this.resultBox) this.resultBox.classList.add('hidden');
    }

    showError(message) {
        if (!this.errorBox) return;
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) errorMessage.textContent = message;
        this.errorBox.classList.remove('hidden');
    }

    hideError() {
        if (this.errorBox) this.errorBox.classList.add('hidden');
    }
}

class AuthManager {
    constructor() {
        this.tokenKey = 'fa_auth_token';
        this.userKey = 'fa_auth_user';
        this.loginModal = document.getElementById('loginModal');
        this.loginBtn = document.getElementById('loginBtn');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.userInfo = document.getElementById('userInfo');
        this.userName = document.getElementById('userName');
        this.init();
    }

    init() {
        if (this.loginBtn) {
            this.loginBtn.addEventListener('click', () => this.showLogin());
        }
        if (this.logoutBtn) {
            this.logoutBtn.addEventListener('click', () => this.logout());
        }
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }
        this.checkAuth();
    }

    getToken() {
        return localStorage.getItem(this.tokenKey);
    }

    getUser() {
        const stored = localStorage.getItem(this.userKey);
        return stored ? JSON.parse(stored) : null;
    }

    setAuth(token, user) {
        localStorage.setItem(this.tokenKey, token);
        localStorage.setItem(this.userKey, JSON.stringify(user));
    }

    clearAuth() {
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem(this.userKey);
    }

    async checkAuth() {
        const token = this.getToken();
        if (!token) {
            this.updateUI(null);
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/auth.php?action=me`, {
                headers: { 'X-Auth-Token': token }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.updateUI(data.data);
                    return;
                }
            }
        } catch (e) {
            console.error('Auth check failed:', e);
        }
        this.clearAuth();
        this.updateUI(null);
    }

    updateUI(user) {
        if (user) {
            this.loginBtn?.classList.add('hidden');
            this.userInfo?.classList.remove('hidden');
            if (this.userName) this.userName.textContent = user.real_name + ' (' + user.role + ')';
            
            const approvalTab = document.getElementById('approvalTab');
            if (approvalTab) {
                if (user.role === 'supervisor' || user.role === 'admin') {
                    approvalTab.style.display = 'block';
                } else {
                    approvalTab.style.display = 'none';
                }
            }
        } else {
            this.loginBtn?.classList.remove('hidden');
            this.userInfo?.classList.add('hidden');
            const approvalTab = document.getElementById('approvalTab');
            if (approvalTab) approvalTab.style.display = 'none';
        }
    }

    showLogin() {
        if (this.loginModal) {
            this.loginModal.classList.remove('hidden');
            uiManager.showOverlay();
        }
    }

    hideLogin() {
        if (this.loginModal) {
            this.loginModal.classList.add('hidden');
            uiManager.hideOverlay();
        }
    }

    async login() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        if (!username || !password) {
            uiManager.alert('请输入用户名和密码');
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/auth.php?action=login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.success) {
                this.setAuth(data.data.token, data.data.user);
                this.updateUI(data.data.user);
                this.hideLogin();
                uiManager.alert('登录成功', '欢迎 ' + data.data.user.real_name);
                exportManager.loadExports();
                assetListManager.search();
            } else {
                uiManager.alert(data.error || '登录失败');
            }
        } catch (e) {
            uiManager.alert('网络错误，请稍后重试');
        }
    }

    async logout() {
        const token = this.getToken();
        if (token) {
            try {
                await fetch(`${API_BASE}/auth.php?action=logout`, {
                    method: 'POST',
                    headers: { 'X-Auth-Token': token }
                });
            } catch (e) {}
        }
        this.clearAuth();
        this.updateUI(null);
        uiManager.alert('已退出登录');
    }

    getAuthHeaders() {
        const token = this.getToken();
        return token ? { 'X-Auth-Token': token } : {};
    }

    requireLogin() {
        const token = this.getToken();
        if (!token) {
            uiManager.confirm('此功能需要登录，是否立即登录？', () => {
                this.showLogin();
            }, '需要登录');
            return false;
        }
        return true;
    }
}

class AssetListManager {
    constructor() {
        this.page = 1;
        this.pageSize = 10;
        this.total = 0;
        this.departments = [];
        this.init();
    }

    init() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
        document.getElementById(`tab-${tab}`)?.classList.remove('hidden');
        
        if (tab === 'list') {
            this.search();
        } else if (tab === 'export') {
            exportManager.loadExports();
        } else if (tab === 'approval') {
            approvalManager.loadApprovals();
        }
    }

    async search() {
        if (!authManager.requireLogin()) return;
        
        const keyword = document.getElementById('listKeyword').value.trim();
        const department = document.getElementById('listDepartment').value;
        const status = document.getElementById('listStatus').value;
        
        this.showLoading();
        
        try {
            const params = new URLSearchParams({
                mode: 'list',
                page: this.page,
                pageSize: this.pageSize,
                keyword,
                department,
                status
            });
            
            const response = await fetch(`${API_BASE}/query.php?${params}`, {
                headers: { ...authManager.getAuthHeaders(), ...connectionManager.getHeaders() }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.total = data.data.total;
                this.departments = data.data.departments;
                this.renderDepartments();
                this.renderList(data.data.list);
                this.renderPagination();
                document.getElementById('listTotal').textContent = `共 ${this.total} 条记录`;
            } else {
                uiManager.alert(data.error || '查询失败');
            }
        } catch (e) {
            uiManager.alert('网络错误，请稍后重试');
        } finally {
            this.hideLoading();
        }
    }

    renderDepartments() {
        const select = document.getElementById('listDepartment');
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '<option value="">全部</option>';
        this.departments.forEach(dept => {
            select.innerHTML += `<option value="${dept}">${dept}</option>`;
        });
        select.value = currentValue;
    }

    renderList(list) {
        const tbody = document.getElementById('assetListBody');
        if (!tbody) return;
        
        const statusMap = {
            'normal': { text: '正常', class: 'status-approved' },
            'scrapped': { text: '已报废', class: 'status-rejected' },
            'loaned': { text: '已借出', class: 'status-pending' }
        };
        
        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-gray-500">暂无数据</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = list.map(item => {
            const status = statusMap[item.status] || { text: item.status, class: '' };
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm font-mono text-gray-900">${item.facode}</td>
                    <td class="px-4 py-3 text-sm font-mono text-gray-600">${item.sn}</td>
                    <td class="px-4 py-3 text-sm text-gray-900">${item.asset_name || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-600">${item.user_name || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-600">${item.department || '-'}</td>
                    <td class="px-4 py-3">
                        <span class="status-badge ${status.class}">${status.text}</span>
                    </td>
                </tr>
            `;
        }).join('');
    }

    renderPagination() {
        const container = document.getElementById('assetListPagination');
        if (!container) return;
        
        const totalPages = Math.ceil(this.total / this.pageSize);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = `
            <span class="text-sm text-gray-600">第 ${this.page} / ${totalPages} 页</span>
            <div class="flex gap-1">
                <button class="pagination-btn" onclick="window.assetListManager.goToPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>上一页</button>
        `;
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.page - 2 && i <= this.page + 2)) {
                html += `<button class="pagination-btn ${i === this.page ? 'active' : ''}" onclick="window.assetListManager.goToPage(${i})">${i}</button>`;
            } else if (i === this.page - 3 || i === this.page + 3) {
                html += '<span class="px-2">...</span>';
            }
        }
        
        html += `
                <button class="pagination-btn" onclick="window.assetListManager.goToPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>下一页</button>
            </div>
        `;
        
        container.innerHTML = html;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.total / this.pageSize);
        if (page < 1 || page > totalPages) return;
        this.page = page;
        this.search();
    }

    showLoading() {
        document.getElementById('assetListLoading')?.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('assetListLoading')?.classList.add('hidden');
    }
}

class ExportManager {
    constructor() {
        this.page = 1;
        this.pageSize = 10;
        this.total = 0;
        this.currentFilter = '';
        this.fields = [];
        this.supervisors = [];
        this.currentExportToken = null;
        this.init();
    }

    init() {
        const purposeInput = document.getElementById('exportPurpose');
        if (purposeInput) {
            purposeInput.addEventListener('input', () => {
                document.getElementById('purposeCount').textContent = purposeInput.value.length;
                this.updateWatermarkPreview();
            });
        }
    }

    async openExportModal() {
        if (!authManager.requireLogin()) return;
        
        await this.loadFields();
        await this.loadSupervisors();
        this.renderFields();
        this.updateWatermarkPreview();
        
        document.getElementById('exportPurpose').value = '';
        document.getElementById('purposeCount').textContent = '0';
        document.getElementById('exportSupervisor').value = '';
        document.querySelectorAll('input[name="exportFormat"]')[0].checked = true;
        
        document.getElementById('exportModal').classList.remove('hidden');
        uiManager.showOverlay();
    }

    hideExportModal() {
        document.getElementById('exportModal').classList.add('hidden');
        uiManager.hideOverlay();
    }

    async loadFields() {
        try {
            const response = await fetch(`${API_BASE}/export.php?action=fields`, {
                headers: authManager.getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                this.fields = data.data.fields;
            }
        } catch (e) {
            console.error('Load fields failed:', e);
        }
    }

    async loadSupervisors() {
        try {
            const response = await fetch(`${API_BASE}/auth.php?action=supervisors`, {
                headers: authManager.getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                this.supervisors = data.data;
                const select = document.getElementById('exportSupervisor');
                select.innerHTML = '<option value="">请选择主管</option>';
                this.supervisors.forEach(s => {
                    select.innerHTML += `<option value="${s.id}">${s.real_name} (${s.department} - ${s.role === 'admin' ? '管理员' : '主管'})</option>`;
                });
            }
        } catch (e) {
            console.error('Load supervisors failed:', e);
        }
    }

    renderFields() {
        const container = document.getElementById('exportFields');
        if (!container) return;
        
        container.innerHTML = this.fields.map(field => `
            <div>
                <input type="checkbox" id="field_${field.key}" value="${field.key}" class="field-checkbox hidden" 
                    onchange="window.exportManager.handleFieldChange()">
                <label for="field_${field.key}" class="field-label">
                    <span class="flex-1">${field.label}</span>
                    ${field.high_sensitivity ? '<span class="high-sens-badge">高敏</span>' : ''}
                </label>
            </div>
        `).join('');
    }

    handleFieldChange() {
        const selectedFields = this.getSelectedFields();
        const highSensSelected = selectedFields.filter(f => 
            this.fields.find(ff => ff.key === f)?.high_sensitivity
        );
        
        const warningEl = document.getElementById('highSensWarning');
        const supervisorEl = document.getElementById('supervisorSelect');
        const highSensList = document.getElementById('highSensFieldsList');
        
        if (highSensSelected.length > 0) {
            warningEl.classList.remove('hidden');
            supervisorEl.classList.remove('hidden');
            const labels = highSensSelected.map(f => 
                this.fields.find(ff => ff.key === f)?.label
            ).join('、');
            highSensList.textContent = labels;
        } else {
            warningEl.classList.add('hidden');
            supervisorEl.classList.add('hidden');
        }
        
        this.updateWatermarkPreview();
    }

    getSelectedFields() {
        const checkboxes = document.querySelectorAll('.field-checkbox:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    getSelectedFormat() {
        const formatRadio = document.querySelector('input[name="exportFormat"]:checked');
        return formatRadio ? formatRadio.value : 'csv';
    }

    updateWatermarkPreview() {
        const user = authManager.getUser();
        const purpose = document.getElementById('exportPurpose').value || '（未填写）';
        const now = new Date().toLocaleString('zh-CN');
        const selectedFields = this.getSelectedFields();
        const recordCount = assetListManager?.total || 0;
        
        const preview = document.getElementById('watermarkPreview');
        if (!preview) return;
        
        preview.innerHTML = `
            <div class="font-bold text-red-600 mb-2">⚠️ 机密文件 - 导出审计水印</div>
            <div>导出人：${user?.real_name || '（未登录）'}${user?.username ? ' (用户名: ' + user.username + ')' : ''}</div>
            <div>导出时间：${now}</div>
            <div>导出用途：${purpose}</div>
            <div>导出场数：${selectedFields.length} 个字段</div>
            <div>预计记录数：${recordCount} 条</div>
            <div>链接有效期：24 小时 / 最多下载 3 次</div>
            <div class="text-red-500 mt-1">保密声明：本文件包含敏感信息，仅限授权人员使用，严禁泄露或转发</div>
        `;
    }

    async submitExport() {
        const fields = this.getSelectedFields();
        const purpose = document.getElementById('exportPurpose').value.trim();
        const format = this.getSelectedFormat();
        const supervisorId = document.getElementById('exportSupervisor').value;
        
        if (fields.length === 0) {
            uiManager.alert('请选择要导出的字段');
            return;
        }
        
        if (!purpose) {
            uiManager.alert('请填写导出用途');
            return;
        }
        
        const highSensSelected = fields.filter(f => 
            this.fields.find(ff => ff.key === f)?.high_sensitivity
        );
        
        if (highSensSelected.length > 0 && !supervisorId) {
            uiManager.alert('导出包含高敏字段，请选择审批主管');
            return;
        }
        
        const filters = {
            keyword: document.getElementById('listKeyword').value.trim(),
            department: document.getElementById('listDepartment').value,
            status: document.getElementById('listStatus').value
        };
        
        try {
            const response = await fetch(`${API_BASE}/export.php?action=request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authManager.getAuthHeaders()
                },
                body: JSON.stringify({
                    fields,
                    purpose,
                    format,
                    filters,
                    supervisor_id: supervisorId ? parseInt(supervisorId) : 0
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.hideExportModal();
                uiManager.alert(data.data.message, '操作成功');
                this.loadExports();
            } else {
                uiManager.alert(data.error || '导出申请提交失败');
            }
        } catch (e) {
            uiManager.alert('网络错误，请稍后重试');
        }
    }

    async loadExports(filter = '') {
        if (!authManager.getToken()) return;
        
        this.currentFilter = filter;
        
        document.querySelectorAll('#filterAll, #filterPending, #filterApproved, #filterRejected, #filterExpired')
            .forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById('filter' + (filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : 'All'));
        activeBtn?.classList.add('active');
        
        this.showLoading();
        
        try {
            const params = new URLSearchParams({
                action: 'list',
                page: this.page,
                pageSize: this.pageSize,
                status: filter
            });
            
            const response = await fetch(`${API_BASE}/export.php?${params}`, {
                headers: authManager.getAuthHeaders()
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.total = data.data.total;
                this.renderExportList(data.data.list);
                this.renderPagination();
            }
        } catch (e) {
            console.error('Load exports failed:', e);
        } finally {
            this.hideLoading();
        }
    }

    renderExportList(list) {
        const container = document.getElementById('exportListContent');
        if (!container) return;
        
        if (list.length === 0) {
            container.innerHTML = `
                <div class="text-center py-10 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    <p class="text-gray-400 text-sm">暂无导出记录</p>
                </div>
            `;
            return;
        }
        
        const statusMap = {
            'pending': { text: '待审批', class: 'status-pending' },
            'approved': { text: '已批准', class: 'status-approved' },
            'rejected': { text: '已驳回', class: 'status-rejected' },
            'expired': { text: '已过期', class: 'status-expired' }
        };
        
        container.innerHTML = list.map(item => {
            const status = statusMap[item.status] || { text: item.status, class: '' };
            const fieldLabels = item.fields.map(f => 
                f.high_sensitivity ? `<span class="text-red-600">${f.label}</span>` : f.label
            ).join('、');
            
            let actionHtml = '';
            if (item.can_download && item.download_url) {
                actionHtml = `
                    <button onclick="window.exportManager.downloadFile('${item.export_token}', '${item.file_name}')"
                        class="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-md hover:bg-emerald-700 transition font-medium inline-block">
                        下载 (${item.download_count}/${item.max_downloads})
                    </button>
                `;
            } else if (item.status === 'pending') {
                actionHtml = `
                    <button onclick="window.exportManager.cancelExport('${item.export_token}')"
                        class="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition font-medium">
                        取消申请
                    </button>
                `;
            } else if (item.is_expired) {
                actionHtml = `<span class="text-gray-400 text-sm">链接已过期</span>`;
            } else if (item.status === 'rejected') {
                actionHtml = `<span class="text-red-500 text-sm">已驳回: ${item.approval_comment || '-'}</span>`;
            } else if (item.download_count >= item.max_downloads) {
                actionHtml = `<span class="text-gray-400 text-sm">下载次数已用完</span>`;
            }
            
            return `
                <div class="bg-white border border-gray-200 rounded-lg p-4 mb-3 hover:shadow-md transition-all">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="status-badge ${status.class}">${status.text}</span>
                                <span class="text-sm text-gray-500">${item.file_format.toUpperCase()} 格式</span>
                                ${item.requires_approval ? '<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">需审批</span>' : ''}
                            </div>
                            <div class="text-sm text-gray-700 mb-1">
                                <span class="font-medium">导出场：</span>${fieldLabels}
                            </div>
                            <div class="text-sm text-gray-600 mb-1">
                                <span class="font-medium">用途：</span>${item.purpose}
                            </div>
                            <div class="text-xs text-gray-400 flex gap-4">
                                <span>导出人：${item.user_name}</span>
                                <span>记录数：${item.total_count} 条</span>
                                <span>创建时间：${new Date(item.created_at).toLocaleString('zh-CN')}</span>
                                <span>过期时间：${new Date(item.expires_at).toLocaleString('zh-CN')}</span>
                            </div>
                            ${item.supervisor_name ? `<div class="text-xs text-gray-400 mt-1">审批主管：${item.supervisor_name}</div>` : ''}
                        </div>
                        <div class="ml-4">
                            ${actionHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderPagination() {
        const container = document.getElementById('exportListPagination');
        if (!container) return;
        
        const totalPages = Math.ceil(this.total / this.pageSize);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = `
            <span class="text-sm text-gray-600">第 ${this.page} / ${totalPages} 页</span>
            <div class="flex gap-1">
                <button class="pagination-btn" onclick="window.exportManager.goToPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>上一页</button>
        `;
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.page - 2 && i <= this.page + 2)) {
                html += `<button class="pagination-btn ${i === this.page ? 'active' : ''}" onclick="window.exportManager.goToPage(${i})">${i}</button>`;
            } else if (i === this.page - 3 || i === this.page + 3) {
                html += '<span class="px-2">...</span>';
            }
        }
        
        html += `
                <button class="pagination-btn" onclick="window.exportManager.goToPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>下一页</button>
            </div>
        `;
        
        container.innerHTML = html;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.total / this.pageSize);
        if (page < 1 || page > totalPages) return;
        this.page = page;
        this.loadExports(this.currentFilter);
    }

    cancelExport(token) {
        uiManager.confirm('确定要取消这个导出申请吗？', async () => {
            try {
                const response = await fetch(`${API_BASE}/export.php?action=cancel`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authManager.getAuthHeaders()
                    },
                    body: JSON.stringify({ token })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    uiManager.alert('已取消导出申请');
                    this.loadExports(this.currentFilter);
                } else {
                    uiManager.alert(data.error || '取消失败');
                }
            } catch (e) {
                uiManager.alert('网络错误，请稍后重试');
            }
        }, '取消导出申请');
    }

    async downloadFile(token, fileName) {
        try {
            const response = await fetch(`${API_BASE}/download.php?token=${token}`, {
                headers: authManager.getAuthHeaders()
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `下载失败 (${response.status})`);
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName || `export_${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            this.loadExports(this.currentFilter);
        } catch (e) {
            console.error('Download failed:', e);
            uiManager.alert(e.message || '下载失败');
        }
    }

    showLoading() {
        document.getElementById('exportListLoading')?.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('exportListLoading')?.classList.add('hidden');
    }
}

class ApprovalManager {
    constructor() {
        this.page = 1;
        this.pageSize = 10;
        this.total = 0;
        this.currentFilter = '';
        this.currentApprovalId = null;
    }

    async loadApprovals(filter = '') {
        if (!authManager.getToken()) return;
        
        this.currentFilter = filter;
        
        document.querySelectorAll('#appFilterAll, #appFilterPending, #appFilterApproved, #appFilterRejected')
            .forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById('appFilter' + (filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : 'All'));
        activeBtn?.classList.add('active');
        
        this.showLoading();
        
        try {
            const params = new URLSearchParams({
                action: 'list',
                page: this.page,
                pageSize: this.pageSize,
                status: filter
            });
            
            const response = await fetch(`${API_BASE}/approval.php?${params}`, {
                headers: authManager.getAuthHeaders()
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.total = data.data.total;
                this.currentList = data.data.list;
                this.renderApprovalList(data.data.list);
                this.renderPagination();
            }
        } catch (e) {
            console.error('Load approvals failed:', e);
        } finally {
            this.hideLoading();
        }
    }

    renderApprovalList(list) {
        const container = document.getElementById('approvalListContent');
        if (!container) return;
        
        if (list.length === 0) {
            container.innerHTML = `
                <div class="text-center py-10 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    <p class="text-gray-400 text-sm">暂无审批记录</p>
                </div>
            `;
            return;
        }
        
        const statusMap = {
            'pending': { text: '待审批', class: 'status-pending' },
            'approved': { text: '已批准', class: 'status-approved' },
            'rejected': { text: '已驳回', class: 'status-rejected' }
        };
        
        container.innerHTML = list.map(item => {
            const status = statusMap[item.status] || { text: item.status, class: '' };
            const fieldLabels = item.high_sensitivity_fields.map(f => f.label).join('、');
            
            let actionHtml = '';
            if (item.status === 'pending') {
                actionHtml = `
                    <button onclick="window.approvalManager.openApprovalModal(${item.id})"
                        class="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition font-medium">
                        处理
                    </button>
                `;
            }
            
            return `
                <div class="bg-white border border-gray-200 rounded-lg p-4 mb-3 hover:shadow-md transition-all">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="status-badge ${status.class}">${status.text}</span>
                                <span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">高敏字段</span>
                            </div>
                            <div class="text-sm text-gray-700 mb-1">
                                <span class="font-medium">高敏字段：</span><span class="text-red-600">${fieldLabels}</span>
                            </div>
                            <div class="text-sm text-gray-600 mb-1">
                                <span class="font-medium">用途：</span>${item.purpose}
                            </div>
                            <div class="text-sm text-gray-600 mb-1">
                                <span class="font-medium">申请人：</span>${item.applicant_name}
                            </div>
                            <div class="text-xs text-gray-400 flex gap-4">
                                <span>记录数：${item.total_count > 0 ? item.total_count + ' 条' : '待生成'}</span>
                                <span>格式：${item.file_format.toUpperCase()}</span>
                                <span>申请时间：${new Date(item.created_at).toLocaleString('zh-CN')}</span>
                            </div>
                            ${item.approval_comment ? `<div class="text-xs text-gray-500 mt-1">审批意见：${item.approval_comment}</div>` : ''}
                        </div>
                        <div class="ml-4">
                            ${actionHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async openApprovalModal(approvalId) {
        this.currentApprovalId = approvalId;
        
        const item = this.currentList?.find(i => i.id === approvalId);
        if (!item) {
            uiManager.alert('找不到审批记录');
            return;
        }
        
        try {
            const fieldLabels = item.high_sensitivity_fields.map(f => 
                `<span class="text-red-600 font-medium">${f.label}</span>`
            ).join('、');
            
            const detailEl = document.getElementById('approvalDetail');
            if (detailEl) {
                detailEl.innerHTML = `
                    <div class="bg-gray-50 rounded-lg p-4 space-y-3">
                        <div>
                            <span class="text-xs text-gray-500 uppercase font-semibold">申请人</span>
                            <div class="text-sm text-gray-900 font-medium">${item.applicant_name}</div>
                        </div>
                        <div>
                            <span class="text-xs text-gray-500 uppercase font-semibold">高敏字段</span>
                            <div class="text-sm text-gray-900">${fieldLabels}</div>
                        </div>
                        <div>
                            <span class="text-xs text-gray-500 uppercase font-semibold">导出用途</span>
                            <div class="text-sm text-gray-900">${item.purpose}</div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <span class="text-xs text-gray-500 uppercase font-semibold">文件格式</span>
                                <div class="text-sm text-gray-900">${item.file_format.toUpperCase()}</div>
                            </div>
                            <div>
                                <span class="text-xs text-gray-500 uppercase font-semibold">记录数量</span>
                                <div class="text-sm text-gray-900">${item.total_count > 0 ? item.total_count + ' 条' : '审批通过后生成'}</div>
                            </div>
                        </div>
                        <div>
                            <span class="text-xs text-gray-500 uppercase font-semibold">申请时间</span>
                            <div class="text-sm text-gray-900">${new Date(item.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                    </div>
                `;
            }
            
            document.getElementById('approvalComment').value = '';
            document.getElementById('approvalModal').classList.remove('hidden');
            uiManager.showOverlay();
        } catch (e) {
            console.error('Open approval modal failed:', e);
            uiManager.alert('加载审批详情失败');
        }
    }

    hideApprovalModal() {
        document.getElementById('approvalModal').classList.add('hidden');
        uiManager.hideOverlay();
        this.currentApprovalId = null;
    }

    async handleApprove() {
        const comment = document.getElementById('approvalComment').value.trim();
        if (!comment) {
            uiManager.alert('请填写审批意见');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/approval.php?action=approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authManager.getAuthHeaders()
                },
                body: JSON.stringify({
                    id: this.currentApprovalId,
                    comment
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.hideApprovalModal();
                uiManager.alert('已批准导出申请', '操作成功');
                this.loadApprovals(this.currentFilter);
            } else {
                uiManager.alert(data.error || '批准失败');
            }
        } catch (e) {
            uiManager.alert('网络错误，请稍后重试');
        }
    }

    async handleReject() {
        const comment = document.getElementById('approvalComment').value.trim();
        if (!comment) {
            uiManager.alert('请填写审批意见');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/approval.php?action=reject`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authManager.getAuthHeaders()
                },
                body: JSON.stringify({
                    id: this.currentApprovalId,
                    comment
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.hideApprovalModal();
                uiManager.alert('已驳回导出申请', '操作成功');
                this.loadApprovals(this.currentFilter);
            } else {
                uiManager.alert(data.error || '驳回失败');
            }
        } catch (e) {
            uiManager.alert('网络错误，请稍后重试');
        }
    }

    renderPagination() {
        const container = document.getElementById('approvalListPagination');
        if (!container) return;
        
        const totalPages = Math.ceil(this.total / this.pageSize);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = `
            <span class="text-sm text-gray-600">第 ${this.page} / ${totalPages} 页</span>
            <div class="flex gap-1">
                <button class="pagination-btn" onclick="window.approvalManager.goToPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>上一页</button>
        `;
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.page - 2 && i <= this.page + 2)) {
                html += `<button class="pagination-btn ${i === this.page ? 'active' : ''}" onclick="window.approvalManager.goToPage(${i})">${i}</button>`;
            } else if (i === this.page - 3 || i === this.page + 3) {
                html += '<span class="px-2">...</span>';
            }
        }
        
        html += `
                <button class="pagination-btn" onclick="window.approvalManager.goToPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>下一页</button>
            </div>
        `;
        
        container.innerHTML = html;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.total / this.pageSize);
        if (page < 1 || page > totalPages) return;
        this.page = page;
        this.loadApprovals(this.currentFilter);
    }

    showLoading() {
        document.getElementById('approvalListLoading')?.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('approvalListLoading')?.classList.add('hidden');
    }
}

const uiManager = new UIManager();
const connectionManager = new ConnectionManager();
const historyManager = new HistoryManager();
const queryManager = new QueryManager();
const authManager = new AuthManager();
const assetListManager = new AssetListManager();
const exportManager = new ExportManager();
const approvalManager = new ApprovalManager();

window.uiManager = uiManager;
window.connectionManager = connectionManager;
window.historyManager = historyManager;
window.queryManager = queryManager;
window.authManager = authManager;
window.assetListManager = assetListManager;
window.exportManager = exportManager;
window.approvalManager = approvalManager;