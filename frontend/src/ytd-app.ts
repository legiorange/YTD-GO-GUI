import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import * as API from '../wailsjs/go/main/App';
import { EventsOn} from '../wailsjs/runtime/runtime';

@customElement('ytd-app')
export class YtdApp extends LitElement {
    @state() private currentView = 'single';
    @state() private theme = 'light';
    @state() private url = '';
    @state() private batchUrls = '';
    @state() private videoDetails: any = null;
    @state() private playlistItems: any[] = [];
    @state() private selectedFormat = '';
    @state() private tasks: Map<string, any> = new Map();
    @state() private history: any[] = [];
    @state() private downloadPath = '默认路径';
    @state() private isAnalyzing = false;

    static styles = css`
        :host {
            --bg-main: #f0f2f5; --bg-card: #ffffff; --bg-input: #ffffff;
            --text-main: #1c1e21; --text-sub: #606770; --border: #dddfe2;
            --accent: #d93025; --sidebar-active: #fce8e6;
            display: flex; height: 100vh; width: 100vw; font-family: system-ui, sans-serif;
            background: var(--bg-main); color: var(--text-main); transition: background 0.2s;
            overflow: hidden;
        }
        :host([theme="dark"]) {
            --bg-main: #18191a; --bg-card: #242526; --bg-input: #3a3b3c;
            --text-main: #e4e6eb; --text-sub: #b0b3b8; --border: #3e4042;
            --sidebar-active: #3c1e1e;
        }

        .sidebar { width: 220px; background: var(--bg-card); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 20px 0; }
        .nav-item { 
            padding: 12px 24px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
            color: var(--text-main); font-weight: 500; transition: 0.2s; 
        }
        .nav-item.active { background: var(--sidebar-active); color: var(--accent); border-right: 4px solid var(--accent); }
        .badge { background: var(--accent); color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; }

        .content { flex: 1; padding: 40px; overflow-y: auto; }
        .card { background: var(--bg-card); padding: 30px; border-radius: 12px; border: 1px solid var(--border); max-width: 900px; margin: 0 auto; }
        /* 批量下载 */
        .playlist-scroll {
            max-height: 400px;
            overflow-y: auto;
            margin-top: 15px;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 5px;
            background: var(--bg-main);
        }
        .playlist-item {
            display: flex;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid var(--border);
            gap: 12px;
        }
        .playlist-item:last-child { border-bottom: none; }
        .playlist-item img { width: 80px; border-radius: 4px; }
        /* 历史记录卡片样式 */
        .history-card {
            display: flex;
            gap: 15px;
            padding: 15px;
            background: var(--bg-main);
            border: 1px solid var(--border);
            border-radius: 10px;
            margin-bottom: 15px;
            transition: transform 0.2s;
        }
        .history-card:hover {
            transform: translateY(-2px);
            border-color: var(--accent);
        }
        .history-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .history-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-main);
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .action-group {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        /* 修复暗黑模式表单对比度 */
        input, select, textarea { 
            width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border);
            background: var(--bg-input); color: var(--text-main); font-size: 14px; outline: none;
            box-sizing: border-box;
        }
        select {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace; /* 等宽字体对齐表格 */
            background: var(--bg-input);
            color: var(--text-main);
            border: 2px solid var(--accent);
            border-radius: 6px;
            padding: 12px;
            font-size: 13px;
            width: 100%;
        }

        select option {
            background: var(--bg-card) !important;
            color: var(--text-main) !important;
            padding: 10px;
        }

        .format-header {
            font-size: 11px;
            color: var(--accent);
            font-weight: bold;
            margin: 15px 0 5px 2px;
            display: flex;
            justify-content: space-between;
        }
        .btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; font-size: 14px; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text-main); }

        .item-row { display: flex; gap: 20px; padding: 20px; background: var(--bg-main); border-radius: 12px; margin-top: 15px; align-items: center; }
        .thumb { width: 160px; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; background: #000; }

        .progress-container { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; margin: 10px 0; }
        .progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }
        .stats { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-sub); }
    `;

async firstUpdated() {
        // 1. 初始化设置：从本地数据库读取主题偏好和下载路径
        const t = await API.GetSetting("theme");
        if (t) {
            this.theme = t;
            this.applyTheme();
        }
        
        const p = await API.GetSetting("download_path");
        if (p) {
            this.downloadPath = p;
        }

        // 2. 核心：监听实时下载进度事件
        EventsOn("task_progress", (data: any) => {
            // data 结构必须与 Go 端发送的一致: { id, percent, speed, eta, status }
            const task = this.tasks.get(data.id);
            if (task) {
                // 更新任务对象，并将状态从初始的 'Waiting' 强制改为 'Downloading'
                const updatedTask = { 
                    ...task, 
                    percent: data.percent || "0", 
                    speed: data.speed || "计算中...", 
                    eta: data.eta || "--:--",
                    status: data.status || 'Downloading' 
                };

                // 将更新后的对象重新塞回 Map
                this.tasks.set(data.id, updatedTask);

                // ✨ 关键点：如果当前正停留在下载页面，必须强制重绘 UI
                // 否则你会发现 console 有数据，但进度条和百分比数字不动
                if (this.currentView === 'downloading') {
                    this.requestUpdate();
                }
            }
        });

        // 3. 监听任务开始执行事件 (从排队进入正式下载)
        EventsOn("task_started", (id: string) => {
            const task = this.tasks.get(id);
            if (task) {
                this.tasks.set(id, { ...task, status: 'Downloading' });
                this.requestUpdate();
            }
        });

        // 4. 监听任务完成事件
        EventsOn("task_complete", (id: string) => {
            // 下载成功后，从实时任务 Map 中移除
            this.tasks.delete(id);
            this.requestUpdate();

            // 如果用户在历史记录页，则自动刷新以显示新文件
            if (this.currentView === 'finished') {
                this.refreshHistory();
            }
        });

        // 5. 监听错误事件
        EventsOn("task_error", (data: any) => {
            const task = this.tasks.get(data.id);
            if (task) {
                this.tasks.set(data.id, { ...task, status: 'Error', speed: '失败' });
                this.requestUpdate();
                console.error(`任务 [${data.id}] 下载失败`);
            }
        });
        
        // 初次加载时，先后台拉取一次历史记录
        this.refreshHistory();
    }

    applyTheme() { this.theme === 'dark' ? this.setAttribute('theme', 'dark') : this.removeAttribute('theme'); }

private async addDownload(url: string, title: string, thumb: string) {
        if (!url) return;

        // 1. 生成唯一 ID 并记录到当前任务 Map 中
        const id = Math.random().toString(36).substring(2, 10);
        this.tasks.set(id, { 
            id, 
            title, 
            thumbnail: thumb, 
            percent: 0, 
            status: 'Waiting',
            speed: '0B/s',
            eta: '--:--'
        });
        
        // 2. 调用后端接口启动下载
        await API.StartDownloadTask(id, url, this.selectedFormat, title, thumb);
        
        // 3. ✨ 核心修复：清除当前页面所有临时信息
        this.url = '';             // 清空单个下载链接输入框
        this.videoDetails = null;  // 销毁视频信息预览卡片
        this.selectedFormat = '';  // 重置选中的格式 ID
        this.batchUrls = '';       // 清空批量下载文本域
        this.playlistItems = [];   // 清空解析出的播放列表预览

        // 4. 自动跳转至下载进度页面
        this.currentView = 'downloading';
        
        // 5. 强制更新 UI
        this.requestUpdate();
    }
    render() {
        return html`
            <div class="sidebar">
                <div class="nav-item ${this.currentView==='single'?'active':''}" @click=${()=>this.currentView='single'}>🎬 单个视频</div>
                <div class="nav-item ${this.currentView==='batch'?'active':''}" @click=${()=>this.currentView='batch'}>📚 批量与列表</div>
                <div class="nav-item ${this.currentView==='downloading'?'active':''}" @click=${()=>this.currentView='downloading'}>
                    <span>⏳ 正在下载</span>
                    ${this.tasks.size > 0 ? html`<span class="badge">${this.tasks.size}</span>` : ''}
                </div>
                <div class="nav-item ${this.currentView==='finished'?'active':''}" @click=${()=>this.currentView='finished'}>✅ 下载历史</div>
                <div style="flex:1"></div>
                <div class="nav-item ${this.currentView==='settings'?'active':''}" @click=${()=>this.currentView='settings'}>⚙️ 设置选项</div>
            </div>
            <div class="content">
                ${this.renderView()}
            </div>
        `;
    }

    private renderView() {
        switch(this.currentView) {
            case 'single': return this.viewSingle();
            case 'batch': return this.viewBatch();
            case 'downloading': return this.viewDownloading();
            case 'finished': this.refreshHistory(); return this.viewHistory();
            case 'settings': return this.viewSettings();
            default: return html``;
        }
    }

private viewSingle() {
        return html`<div class="card">
            <h2>单个视频解析 🎬</h2>
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <input type="text" .value=${this.url} @input=${(e:any)=>this.url=e.target.value} placeholder="粘贴链接...">
                <button class="btn btn-primary" @click=${async ()=>{this.isAnalyzing=true; this.videoDetails=await API.GetVideoDetails(this.url); this.isAnalyzing=false;}}>
                    ${this.isAnalyzing ? '分析中...' : '解析'}
                </button>
            </div>

            ${this.videoDetails ? html`
                <div class="item-row" style="flex-direction: column; align-items: flex-start;">
                    <div style="display:flex; gap:15px; width:100%;">
                        <img src="${this.videoDetails.thumbnail}" class="thumb" style="width:200px;">
                        <div style="flex:1; font-weight:600; color: var(--text-main);">${this.videoDetails.title}</div>
                    </div>

                    <div style="width:100%; margin-top:20px;">
                        <div class="format-header">
                            <span>格式分类 | 推荐 ID | 扩展名 | 分辨率备注</span>
                        </div>
                        <select @change=${(e:any)=>this.selectedFormat=e.target.value}>
                            <option value="">🚀 自动选择 (Best Video + Best Audio)</option>
                            ${this.videoDetails.processed_formats?.map((f:any)=>html`
                                <option value="${f.format_id}">${f.label}</option>
                            `)}
                        </select>
                        
                        <button class="btn btn-primary" style="width:100%; margin-top:20px; height:50px;" 
                            @click=${()=>this.addDownload(this.url, this.videoDetails.title, this.videoDetails.thumbnail)}>
                            确认并添加到下载队列
                        </button>
                    </div>
                </div>
            `:''}
        </div>`;
    }

private viewBatch() {
        return html`<div class="card">
            <h2>批量与播放列表 📚(施工中)</h2>
            <p style="color:var(--text-sub); font-size:13px;">
                💡 <b>批量模式：</b>每行输入一个视频链接直接下载。<br>
                💡 <b>列表模式：</b>输入 YouTube 播放列表链接，解析后可选择下载。
            </p>
            
            <textarea 
                style="height:120px; margin-top:10px; font-family: monospace;" 
                .value=${this.batchUrls} 
                @input=${(e:any)=>this.batchUrls=e.target.value} 
                placeholder="在此处输入链接，每行一个...">
            </textarea>

            <div style="display:flex; gap:10px; margin-top:15px;">
                <button class="btn btn-primary" ?disabled=${!this.batchUrls || this.isAnalyzing} @click=${async () => {
                    const lines = this.batchUrls.split('\n').filter(l => l.trim().startsWith('http'));
                    for (const line of lines) {
                        await this.addDownload(line.trim(), "批量任务", "");
                    }
                }}>直接开始批量任务</button>
                
                <button class="btn btn-outline" ?disabled=${this.isAnalyzing} @click=${async ()=>{
                    if(!this.batchUrls) return;
                    this.isAnalyzing = true;
                    this.playlistItems = await API.GetPlaylistDetails(this.batchUrls.trim());
                    this.isAnalyzing = false;
                }}>
                    ${this.isAnalyzing ? '正在深度解析列表...' : '解析播放列表'}
                </button>
            </div>

            ${this.playlistItems.length > 0 ? html`
                <div style="margin-top:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h4 style="margin:0;">列表内容 (${this.playlistItems.length} 个视频)</h4>
                        <button class="btn btn-primary" style="padding:4px 12px; font-size:12px;" @click=${async () => {
                            for (const item of this.playlistItems) {
                                await this.addDownload(item.url, item.title, item.thumbnail);
                            }
                        }}>下载全部视频</button>
                    </div>
                    
                    <div class="playlist-scroll">
                        ${this.playlistItems.map(i => html`
                            <div class="playlist-item">
                                <img src="${i.thumbnail || 'https://via.placeholder.com/80x45?text=Video'}">
                                <div style="flex:1; font-size:13px; font-weight:500; color:var(--text-main); overflow:hidden; text-overflow:ellipsis;">
                                    ${i.title}
                                </div>
                                <button class="btn btn-outline" style="padding:4px 8px; font-size:11px;" 
                                    @click=${()=>this.addDownload(i.url, i.title, i.thumbnail)}>
                                    下载
                                </button>
                            </div>
                        `)}
                    </div>
                </div>
            ` : ''}
        </div>`;
    }
private viewDownloading() {
        return html`<div class="card">
            <h2>当前下载任务 ⏳</h2>
            ${this.tasks.size === 0 ? html`
                <p style="text-align:center; padding:40px; color:var(--text-sub);">没有正在运行的任务</p>
            ` : Array.from(this.tasks.values()).map(t => html`
                <div class="item-row">
                    <img src="${t.thumbnail || ''}" class="thumb" style="width:100px; height:60px; object-fit:cover;">
                    <div style="flex:1">
                        <div style="font-weight:600; font-size:14px; margin-bottom:5px; color:var(--text-main);">${t.title}</div>
                        
                        <div class="progress-container">
                            <div class="progress-fill" style="width: ${t.percent}%"></div>
                        </div>
                        
                        <div class="stats" style="margin-top:5px;">
                            <span style="color:var(--accent); font-weight:bold;">
                                🚀 ${t.percent}% [${t.status}]
                            </span>
                            <span style="color:var(--text-sub);">
                                ⚡ ${t.speed} | ⏱️ 剩余: ${t.eta}
                            </span>
                        </div>
                    </div>
                </div>
            `)}
        </div>`;
    }
// 渲染历史视图
    private viewHistory() {
        return html`
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="margin:0;">下载历史 ✅</h2>
                <button class="btn btn-outline" @click=${this.refreshHistory}>🔄 刷新列表</button>
            </div>

            ${this.history.length === 0 ? html`
                <div style="text-align:center; padding:50px; color:var(--text-sub);">
                    <div style="font-size:40px; margin-bottom:10px;">📂</div>
                    <p>暂无下载历史记录，快去下载视频吧！</p>
                </div>
            ` : this.history.map(h => html`
                <div class="history-card">
                    <img src="${h.thumbnail}" class="thumb" style="width:140px; height:80px;">
                    <div class="history-info">
                        <div class="history-title">${h.title}</div>
                        <div class="action-group">
                            <button class="btn btn-primary" style="padding:6px 12px; font-size:12px;" 
                                @click=${() => API.OpenFile(h.file_path)}>
                                ▶️ 播放文件
                            </button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px;" 
                                @click=${() => API.OpenFolder(h.file_path)}>
                                📂 打开目录
                            </button>
                            <button class="btn" style="padding:6px 12px; font-size:12px; color:#d93025; background:none;" 
                                @click=${async () => {
                                    if(confirm('是否删除文件？')) {
                                        await API.DeleteHistory(h.id, true); 
                                        this.refreshHistory();
                                    }else{
                                        await API.DeleteHistory(h.id, false); 
                                        this.refreshHistory();
                                    }
                                }}>
                                🗑️ 删除
                            </button>
                        </div>
                    </div>
                </div>
            `)}
        </div>`;
    }

    // 封装刷新逻辑
    private async refreshHistory() {
        this.history = await API.GetHistory() || [];
        this.requestUpdate();
    }

    private viewSettings() {
        return html`<div class="card">
            <h2>应用设置 ⚙️</h2>
            <div style="margin-top:20px;">
                <label style="display:block; margin-bottom:8px; font-weight:bold;">下载保存目录</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" readonly .value=${this.downloadPath}>
                    <button class="btn btn-outline" @click=${async ()=>{this.downloadPath = await API.SelectDirectory()}}>选择目录</button>
                </div>
            </div>
            <div style="margin-top:30px;">
                <label style="display:block; margin-bottom:8px; font-weight:bold;">外观模式切换</label>
                <button class="btn btn-outline" style="width:100%;" @click=${()=>{this.theme=this.theme==='light'?'dark':'light'; this.applyTheme(); API.SaveSetting("theme", this.theme);}}>
                    ${this.theme === 'light' ? '🌙 切换到暗黑模式' : '☀️ 切换到亮色模式'}
                </button>
            </div>
        </div>`;
    }
}