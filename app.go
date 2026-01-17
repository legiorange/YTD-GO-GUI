package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	_ "modernc.org/sqlite"
)

type App struct {
	ctx           context.Context
	db            *sql.DB
	maxConcurrent int
	sem           chan struct{}
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.initDB()
}

func (a *App) initDB() {
	// 初始化数据库，增加 file_path 字段存储下载位置
	db, _ := sql.Open("sqlite", "./ytd.db")
	a.db = db
	a.db.Exec(`CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY, title TEXT, url TEXT, format_id TEXT, 
		thumbnail TEXT, file_path TEXT, status TEXT
	);`)
	a.db.Exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`)

	// 加载并发限制设置
	var mc int
	if err := a.db.QueryRow("SELECT value FROM settings WHERE key = 'max_concurrent'").Scan(&mc); err == nil {
		a.maxConcurrent = mc
	} else {
		a.maxConcurrent = 3 // 默认 3 并发
	}
	a.sem = make(chan struct{}, a.maxConcurrent)
}

// --- 业务逻辑 ---

// GetVideoDetails 获取单个视频详情
func (a *App) GetVideoDetails(url string) map[string]interface{} {
	cmd := exec.Command("./yt-dlp", "--dump-json", "--flat-playlist", url)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	if !strings.HasPrefix(url, "http") {
		vURL := url
		url = "https://www.youtube.com/watch?v=" + vURL
	}
	var rawData map[string]interface{}
	json.Unmarshal(out, &rawData)

	if formats, ok := rawData["formats"].([]interface{}); ok {
		processed := []map[string]string{}
		for _, f := range formats {
			fmtObj := f.(map[string]interface{})

			id := fmt.Sprintf("%v", fmtObj["format_id"])
			ext := fmt.Sprintf("%v", fmtObj["ext"])
			res := fmt.Sprintf("%v", fmtObj["resolution"])
			vcodec := fmt.Sprintf("%v", fmtObj["vcodec"])
			acodec := fmt.Sprintf("%v", fmtObj["acodec"])
			note := fmt.Sprintf("%v", fmtObj["format_note"])

			// 1. 确定格式分类
			category := "🎞️ 普通视频"
			if vcodec != "none" && acodec != "none" {
				category = "🌟 最佳合并流"
			} else if vcodec == "none" {
				category = "🎵 纯音频"
			} else if strings.Contains(res, "2160") || strings.Contains(res, "4320") {
				category = "🔥 超清画质 (4K/8K)"
			}

			// 2. 提取分辨率/音质备注
			info := note
			if info == "null" || info == "" {
				info = res
			}

			// 过滤掉无意义的 low-quality 描述
			if info == "null" || strings.Contains(id, "sb") {
				continue
			}

			// 3. 构造人类易读的 Label
			// 结构：[分类] | ID:xxx | ext | 分辨率
			label := fmt.Sprintf("%-16s | ID: %-5s | %-5s | %s", category, id, ext, info)

			processed = append(processed, map[string]string{
				"format_id": id,
				"label":     label,
			})
		}
		rawData["processed_formats"] = processed
	}
	return rawData
}

// GetPlaylistDetails 解析播放列表中的所有视频
// GetPlaylistDetails 解析播放列表中的所有视频
func (a *App) GetPlaylistDetails(url string) []map[string]string {
	// 使用 --dump-single-json 的平铺模式获取列表项，效率更高
	cmd := exec.Command("./yt-dlp", "--flat-playlist", "--dump-single-json", url)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}

	var playlist struct {
		Entries []map[string]interface{} `json:"entries"`
	}

	if err := json.Unmarshal(out, &playlist); err != nil {
		return nil
	}

	var results []map[string]string
	for _, entry := range playlist.Entries {
		// 提取标题、链接和缩略图
		title := fmt.Sprintf("%v", entry["title"])
		vURL := fmt.Sprintf("%v", entry["url"])
		// 有些链接不带域名，需要补全
		if !strings.HasPrefix(vURL, "http") {
			vURL = "https://www.youtube.com/watch?v=" + vURL
		}

		thumb := ""
		if t, ok := entry["thumbnail"].(string); ok {
			thumb = t
		}

		results = append(results, map[string]string{
			"title":     title,
			"url":       vURL,
			"thumbnail": thumb,
		})
	}
	return results
}

// StartDownloadTask 核心下载函数（带队列控制）
// StartDownloadTask 核心下载函数
func (a *App) StartDownloadTask(id, url, formatId, title, thumbnail string) {
	a.db.Exec("INSERT OR REPLACE INTO tasks (id, title, url, format_id, thumbnail, status) VALUES (?, ?, ?, ?, ?, 'Pending')",
		id, title, url, formatId, thumbnail)

	go func() {
		a.sem <- struct{}{}
		defer func() { <-a.sem }()

		savePath := a.GetSetting("download_path")
		outputTemplate := "%(title)s.%(ext)s"
		if savePath != "" {
			outputTemplate = filepath.Join(savePath, outputTemplate)
		}

		// 获取文件名并锁定状态
		nameCmd := exec.Command("./yt-dlp", "--get-filename", "-o", outputTemplate, url)
		finalPathOut, _ := nameCmd.Output()
		finalPath := strings.TrimSpace(string(finalPathOut))
		a.db.Exec("UPDATE tasks SET status = 'Downloading', file_path = ? WHERE id = ?", finalPath, id)
		wruntime.EventsEmit(a.ctx, "task_started", id)

		// --- 核心参数修复 ---
		args := []string{
			"--newline",     // 1. 强制每行输出，不进入缓存
			"--progress",    // 2. 强制显示进度
			"--no-warnings", // 3. 减少杂讯干扰正则
			"--progress-template", "at:%(progress._speed_str)s eta:%(progress._eta_str)s per:%(progress._percent_str)s",
			"-o", outputTemplate,
		}
		if formatId != "" {
			args = append(args, "-f", formatId)
		}
		args = append(args, url)

		cmd := exec.Command("./yt-dlp", args...)

		// --- 关键点：合并 Stdout 和 Stderr ---
		// 很多环境下 yt-dlp 的进度其实是在 Stderr 输出的
		stdout, _ := cmd.StdoutPipe()
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			return
		}

		// 适配 progress-template 的正则
		rePercent := regexp.MustCompile(`per:([\d\.]+)%`)
		reStats := regexp.MustCompile(`at:([^\s]+)\s+eta:([^\s]+)`)

		// 直接读取管道，不等待缓冲区
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			// 调试开关：如果你在控制台没看到这个输出，说明 stdout 依然是空的
			fmt.Println("yt-dlp output:", line)

			var p, s, e string
			if m := rePercent.FindStringSubmatch(line); len(m) > 1 {
				p = m[1]
			}
			if m := reStats.FindStringSubmatch(line); len(m) > 2 {
				s = m[1]
				e = m[2]
			}

			if p != "" {
				// 只要有百分比就强制触发
				wruntime.EventsEmit(a.ctx, "task_progress", map[string]string{
					"id":      id,
					"percent": p,
					"speed":   s,
					"eta":     e,
					"status":  "Downloading",
				})
			}
		}

		err := cmd.Wait()
		if err == nil {
			a.db.Exec("UPDATE tasks SET status = 'Completed' WHERE id = ?", id)
			wruntime.EventsEmit(a.ctx, "task_complete", id)
		} else {
			a.db.Exec("UPDATE tasks SET status = 'Error' WHERE id = ?", id)
		}
	}()
}

// 获取历史记录的方法
func (a *App) GetHistory() []map[string]string {
	// 仅查询已完成的任务，按 ID 倒序排列
	rows, err := a.db.Query("SELECT id, title, thumbnail, file_path FROM tasks WHERE status = 'Completed' ORDER BY id")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var list []map[string]string
	for rows.Next() {
		var id, t, thumb, p string
		rows.Scan(&id, &t, &thumb, &p)
		list = append(list, map[string]string{
			"id":        id,
			"title":     t,
			"thumbnail": thumb,
			"file_path": p,
		})
	}
	return list
}

// --- 通用辅助方法 ---

func (a *App) GetSetting(k string) string {
	var v string
	a.db.QueryRow("SELECT value FROM settings WHERE key = ?", k).Scan(&v)
	return v
}

func (a *App) SaveSetting(k, v string) {
	a.db.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", k, v)
}

func (a *App) SelectDirectory() string {
	p, _ := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{Title: "选择下载路径"})
	if p != "" {
		a.SaveSetting("download_path", p)
	}
	return p
}

func (a *App) OpenFolder(p string) {
	if runtime.GOOS == "windows" {
		exec.Command("explorer", "/select,", p).Run()
	} else {
		exec.Command("open", "-R", p).Run()
	}
}

func (a *App) OpenFile(p string) {
	if runtime.GOOS == "windows" {
		exec.Command("cmd", "/c", "start", "", p).Run()
	} else {
		exec.Command("open", p).Run()
	}
}

func (a *App) DeleteHistory(id string, removeFile bool) {
	if removeFile {
		var p string
		a.db.QueryRow("SELECT file_path FROM tasks WHERE id = ?", id).Scan(&p)
		os.Remove(p)
	}
	a.db.Exec("DELETE FROM tasks WHERE id = ?", id)
}
