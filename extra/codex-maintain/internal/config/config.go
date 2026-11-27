// Package config updates the user configuration only after network validation.
package config

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pelletier/go-toml/v2"
)

var section = regexp.MustCompile(`^\s*\[([^\[\]]+)\]\s*(?:#.*)?$`)
var option = regexp.MustCompile(`^(\s*respect_system_proxy\s*=\s*)(true|false)(\s*(?:#.*)?)$`)

func Path() (string, error) {
	home := os.Getenv("CODEX_HOME")
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
		home = filepath.Join(home, ".codex")
	}
	return filepath.Join(home, "config.toml"), nil
}
func parse(data []byte) (map[string]any, error) {
	var m map[string]any
	err := toml.Unmarshal(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), &m)
	return m, err
}
func Enabled(m map[string]any) bool {
	f, ok := m["features"].(map[string]any)
	if !ok {
		return false
	}
	b, ok := f["respect_system_proxy"].(bool)
	return ok && b
}

// Prepare rejects unrecognized TOML layouts rather than rewriting unrelated settings.
func Prepare(data []byte) ([]byte, bool, error) {
	if !utf8.Valid(data) {
		return nil, false, errors.New("配置文件不是 UTF-8，无法安全修改")
	}
	m, err := parse(data)
	if err != nil {
		return nil, false, fmt.Errorf("配置 TOML 无法解析：%w", err)
	}
	if Enabled(m) {
		return data, false, nil
	}
	bom := bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf})
	s := string(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
	nl := "\n"
	if strings.Contains(s, "\r\n") {
		nl = "\r\n"
	}
	if strings.Contains(strings.ReplaceAll(s, "\r\n", ""), "\r") {
		return nil, false, errors.New("配置文件换行格式不受支持")
	}
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	inside := false
	found := false
	inserted := false
	var out []string
	for _, line := range lines {
		if match := section.FindStringSubmatch(line); match != nil {
			if inside && !inserted {
				out = append(out, "respect_system_proxy = true")
				inserted = true
			}
			inside = strings.TrimSpace(match[1]) == "features"
			if inside {
				if found {
					return nil, false, errors.New("重复的 features 段")
				}
				found = true
			}
		}
		if inside && strings.HasPrefix(strings.TrimSpace(line), "respect_system_proxy") {
			match := option.FindStringSubmatch(line)
			if match == nil {
				return nil, false, errors.New("代理选项使用无法安全修改的格式")
			}
			if inserted {
				return nil, false, errors.New("代理选项重复")
			}
			line = match[1] + "true" + match[3]
			inserted = true
		}
		out = append(out, line)
	}
	if found && !inserted {
		out = append(out, "respect_system_proxy = true")
	} else if !found {
		out = append(out, "[features]", "respect_system_proxy = true")
	}
	result := []byte(strings.Join(out, nl))
	if bom {
		result = append([]byte{0xef, 0xbb, 0xbf}, result...)
	}
	newMap, err := parse(result)
	if err != nil || !Enabled(newMap) {
		return nil, false, fmt.Errorf("修改后的配置无法安全解析或未生效：%v", err)
	}
	return result, true, nil
}

type Result struct {
	Changed bool
	Backup  string
	Created bool
}

func Apply(path string, now time.Time) (Result, error) {
	var result Result
	original, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	result.Created = !exists
	updated, changed, err := Prepare(original)
	if err != nil {
		return result, err
	}
	if !changed {
		return result, nil
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return result, err
	}
	if exists {
		base := path + ".backup-" + now.Format("20060102-1504")
		for n := 0; ; n++ {
			name := base
			if n > 0 {
				name = fmt.Sprintf("%s-%d", base, n)
			}
			var f *os.File
			f, err = os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if errors.Is(err, os.ErrExist) {
				continue
			}
			if err != nil {
				return result, fmt.Errorf("备份失败：%w", err)
			}
			_, err = f.Write(original)
			if e := f.Close(); err == nil {
				err = e
			}
			if err != nil {
				return result, fmt.Errorf("备份写入失败：%w", err)
			}
			result.Backup = name
			break
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".codex-maintain-*.toml")
	if err != nil {
		return result, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = tmp.Write(updated); err != nil {
		tmp.Close()
		return result, err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return result, err
	}
	if err = tmp.Close(); err != nil {
		return result, err
	}
	current, readErr := os.ReadFile(path)
	if exists && (readErr != nil || !bytes.Equal(current, original)) {
		return result, errors.New("配置在修复期间已改变，已停止写入")
	}
	if !exists && !errors.Is(readErr, os.ErrNotExist) {
		return result, errors.New("配置在修复期间已创建或不可读取，已停止写入")
	}
	if err = os.Rename(tmpName, path); err != nil {
		return result, fmt.Errorf("替换配置失败，原备份：%s：%w", result.Backup, err)
	}
	check, err := os.ReadFile(path)
	if err != nil {
		return result, fmt.Errorf("配置已替换，但读取校验失败；请检查备份 %s：%w", result.Backup, err)
	}
	m, err := parse(check)
	if err != nil || !Enabled(m) {
		return result, fmt.Errorf("写入后校验失败，请检查备份 %s", result.Backup)
	}
	result.Changed = true
	return result, nil
}
