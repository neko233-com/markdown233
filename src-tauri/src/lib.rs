// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use git2::{Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub file: String,
    pub status: String,
    pub is_staged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStrategy {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_default: bool,
    pub needs_target: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub strategy: String,
    pub ok: bool,
    pub message: String,
    pub changed_files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub has_conflict: bool,
    pub message: String,
    pub conflicted_files: Vec<String>,
}

/// Check if a path is a git repository
#[tauri::command]
fn git_is_repo(path: String) -> Result<bool, String> {
    match Repository::open(&path) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Initialize a new git repository
#[tauri::command]
fn git_init(path: String) -> Result<String, String> {
    Repository::init(&path).map_err(|e| e.to_string())?;
    Ok("Git repository initialized".to_string())
}

/// Get current branch name
#[tauri::command]
fn git_current_branch(repo_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head.shorthand().unwrap_or("unknown").to_string();
    Ok(branch_name)
}

/// Get file status
#[tauri::command]
fn git_status(repo_path: String) -> Result<Vec<GitStatus>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        let status = entry.status();
        let path = entry.path().unwrap_or("").to_string();

        let status_str = format_status(status);
        let is_staged = status.contains(Status::INDEX_NEW)
            || status.contains(Status::INDEX_MODIFIED)
            || status.contains(Status::INDEX_DELETED)
            || status.contains(Status::INDEX_RENAMED)
            || status.contains(Status::INDEX_TYPECHANGE);

        result.push(GitStatus {
            file: path,
            status: status_str,
            is_staged,
        });
    }

    Ok(result)
}

/// Stage all changes
#[tauri::command]
fn git_add_all(repo_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;

    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;

    index.write().map_err(|e| e.to_string())?;
    Ok("All changes staged".to_string())
}

/// Stage specific file
#[tauri::command]
fn git_add_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;

    index
        .add_path(Path::new(&file_path))
        .map_err(|e| e.to_string())?;

    index.write().map_err(|e| e.to_string())?;
    Ok(format!("File {} staged", file_path))
}

/// Create a commit with staged changes
#[tauri::command]
fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Get signature
    let signature = repo
        .signature()
        .or_else(|_| git2::Signature::now("Markdown233", "markdown233@local"))
        .map_err(|e| e.to_string())?;

    // Get index
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    // Get parent commit
    let parent_commit = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(|e| e.to_string())?),
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit> = match &parent_commit {
        Some(c) => vec![c],
        None => vec![],
    };

    // Create commit
    let commit_id = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )
        .map_err(|e| e.to_string())?;

    Ok(format!("Committed: {}", commit_id))
}

/// Pull from remote (with conflict detection)
#[tauri::command]
fn git_pull(repo_path: String, remote: String, branch: String) -> Result<ConflictInfo, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // First fetch
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|e| format!("Remote '{}' not found: {}", remote, e))?;

    let mut fetch_options = git2::FetchOptions::new();
    remote_obj
        .fetch(&[&branch], Some(&mut fetch_options), None)
        .map_err(|e| format!("Fetch failed: {}", e))?;

    // Check for conflicts before merge
    let head = repo.head().map_err(|e| e.to_string())?;
    let fetch_head = repo
        .refname_to_id("FETCH_HEAD")
        .map_err(|e| format!("FETCH_HEAD not found: {}", e))?;

    // Check if there are differences
    let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    let fetch_commit = repo.find_commit(fetch_head).map_err(|e| e.to_string())?;

    let merge_base = repo
        .merge_base(head_commit.id(), fetch_commit.id())
        .map_err(|e| e.to_string())?;

    // If merge base is same as fetch head, nothing to pull
    if merge_base == fetch_commit.id() {
        return Ok(ConflictInfo {
            has_conflict: false,
            message: "Already up to date".to_string(),
            conflicted_files: vec![],
        });
    }

    // If merge base is same as head, we can fast-forward
    if merge_base == head_commit.id() {
        if repo_has_changes(&repo)? {
            return Ok(ConflictInfo {
                has_conflict: true,
                message: "Local changes exist. Sync or commit them before pulling.".to_string(),
                conflicted_files: vec![],
            });
        }

        // Fast-forward merge
        let refname = format!("refs/heads/{}", branch);
        repo.reference(
            &refname,
            fetch_commit.id(),
            true,
            &format!("Fast-forward merge to {}", fetch_commit.id()),
        )
        .map_err(|e| e.to_string())?;

        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;

        return Ok(ConflictInfo {
            has_conflict: false,
            message: "Fast-forward merge successful".to_string(),
            conflicted_files: vec![],
        });
    }

    // Check for potential conflicts by analyzing the tree
    let mut conflicted_files = Vec::new();
    let merge_options = git2::MergeOptions::new();
    let has_changes = repo_has_changes(&repo)?;

    if has_changes {
        let merge_index = repo
            .merge_commits(&head_commit, &fetch_commit, Some(&merge_options))
            .map_err(|e| {
                conflicted_files.push(format!("Merge conflict detected: {}", e));
                e.to_string()
            })?;

        if merge_index.has_conflicts() {
            let conflicts = merge_index.conflicts().map_err(|e| e.to_string())?;
            for conflict in conflicts {
                let conflict = conflict.map_err(|e| e.to_string())?;
                let entry = conflict
                    .our
                    .as_ref()
                    .or(conflict.their.as_ref())
                    .or(conflict.ancestor.as_ref());
                if let Some(entry) = entry {
                    conflicted_files.push(String::from_utf8_lossy(&entry.path).to_string());
                }
            }
        }

        if !conflicted_files.is_empty() {
            return Ok(ConflictInfo {
                has_conflict: true,
                message: "Merge conflict detected. Please resolve conflicts manually or choose to overwrite local changes.".to_string(),
                conflicted_files,
            });
        }
    }

    Ok(ConflictInfo {
        has_conflict: true,
        message: "Local and remote histories diverged. Use force pull only when remote should overwrite local.".to_string(),
        conflicted_files: vec![],
    })
}

/// Force reset to remote (accept remote version)
#[tauri::command]
fn git_force_pull(repo_path: String, remote: String, branch: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Fetch from remote
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|e| format!("Remote '{}' not found: {}", remote, e))?;

    let mut fetch_options = git2::FetchOptions::new();
    remote_obj
        .fetch(&[&branch], Some(&mut fetch_options), None)
        .map_err(|e| format!("Fetch failed: {}", e))?;

    let fetch_head = repo
        .refname_to_id("FETCH_HEAD")
        .map_err(|e| format!("FETCH_HEAD not found: {}", e))?;

    let fetch_commit = repo.find_commit(fetch_head).map_err(|e| e.to_string())?;

    // Hard reset to remote
    repo.reset(
        &fetch_commit.as_object(),
        git2::ResetType::Hard,
        Some(git2::build::CheckoutBuilder::default().force()),
    )
    .map_err(|e| e.to_string())?;

    Ok("Forced reset to remote version successful".to_string())
}

/// Push to remote
#[tauri::command]
fn git_push(repo_path: String, remote: String, branch: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|e| format!("Remote '{}' not found: {}", remote, e))?;

    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    let mut push_options = git2::PushOptions::new();

    remote_obj
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("Push failed: {}", e))?;

    Ok("Push successful".to_string())
}

/// Get commit history
#[tauri::command]
fn git_log(repo_path: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|e| e.to_string())?;

    revwalk.push_head().map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }

        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        commits.push(GitCommit {
            hash: oid.to_string(),
            message: commit
                .message()
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            time: chrono::DateTime::from_timestamp(commit.author().when().seconds(), 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_default(),
        });
    }

    Ok(commits)
}

/// Get remote info
#[tauri::command]
fn git_remote(repo_path: String) -> Result<Vec<GitRemote>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let remotes = repo.remotes().map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for remote_name in remotes.iter() {
        let name = remote_name.unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }

        let remote = repo.find_remote(&name).map_err(|e| e.to_string())?;
        let url = remote.url().unwrap_or("").to_string();

        result.push(GitRemote { name, url });
    }

    Ok(result)
}

/// Check if there are merge conflicts
#[tauri::command]
fn git_check_conflicts(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let index = repo.index().map_err(|e| e.to_string())?;

    let mut conflicted_files = Vec::new();
    if index.has_conflicts() {
        let conflicts = index.conflicts().map_err(|e| e.to_string())?;
        for conflict in conflicts {
            let conflict = conflict.map_err(|e| e.to_string())?;
            let entry = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref());
            if let Some(entry) = entry {
                conflicted_files.push(String::from_utf8_lossy(&entry.path).to_string());
            }
        }
    }

    Ok(conflicted_files)
}

/// Abort merge (reset to HEAD)
#[tauri::command]
fn git_abort_merge(repo_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;

    repo.reset(
        &head_commit.as_object(),
        git2::ResetType::Hard,
        Some(git2::build::CheckoutBuilder::default().force()),
    )
    .map_err(|e| e.to_string())?;

    Ok("Merge aborted, reset to HEAD".to_string())
}

/// Add a remote
#[tauri::command]
fn git_add_remote(repo_path: String, name: String, url: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    repo.remote(&name, &url).map_err(|e| e.to_string())?;
    Ok(format!("Remote '{}' added", name))
}

#[tauri::command]
fn sync_strategies() -> Vec<SyncStrategy> {
    vec![
        SyncStrategy {
            id: "git".to_string(),
            name: "Git".to_string(),
            description: "Default native Git sync: commit, pull fast-forward, then push.".to_string(),
            is_default: true,
            needs_target: false,
        },
        SyncStrategy {
            id: "mirror".to_string(),
            name: "Local mirror".to_string(),
            description: "Copy Markdown files into a cloud-drive folder such as OneDrive, iCloud, or Dropbox.".to_string(),
            is_default: false,
            needs_target: true,
        },
    ]
}

#[tauri::command]
fn sync_run(
    repo_path: String,
    strategy_id: Option<String>,
    message: Option<String>,
    mirror_path: Option<String>,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<SyncResult, String> {
    let strategy = strategy_id.unwrap_or_else(|| "git".to_string());
    match strategy.as_str() {
        "git" => sync_git(repo_path, message, remote, branch),
        "mirror" => sync_mirror(repo_path, mirror_path),
        _ => Err(format!("Unknown sync strategy: {}", strategy)),
    }
}

fn sync_git(
    repo_path: String,
    message: Option<String>,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<SyncResult, String> {
    if !Path::new(&repo_path).exists() {
        return Err(format!("Path not found: {}", repo_path));
    }

    if Repository::open(&repo_path).is_err() {
        Repository::init(&repo_path).map_err(|e| e.to_string())?;
    }

    let changed_files = git_status(repo_path.clone())?.len();
    if changed_files > 0 {
        git_add_all(repo_path.clone())?;
        let commit_message = message.unwrap_or_else(|| {
            let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            format!("Sync Markdown233 {}", now)
        });
        git_commit(repo_path.clone(), commit_message)?;
    }

    let remotes = git_remote(repo_path.clone())?;
    if remotes.is_empty() {
        return Ok(SyncResult {
            strategy: "git".to_string(),
            ok: true,
            message: if changed_files > 0 {
                "Git local commit done. No remote configured.".to_string()
            } else {
                "Git repo clean. No remote configured.".to_string()
            },
            changed_files,
        });
    }

    let remote_name = remote.unwrap_or_else(|| remotes[0].name.clone());
    let branch_name = branch
        .or_else(|| git_current_branch(repo_path.clone()).ok())
        .unwrap_or_else(|| "main".to_string());

    let pull = git_pull(repo_path.clone(), remote_name.clone(), branch_name.clone())?;
    if pull.has_conflict {
        return Ok(SyncResult {
            strategy: "git".to_string(),
            ok: false,
            message: pull.message,
            changed_files,
        });
    }

    git_push(repo_path, remote_name, branch_name)?;
    Ok(SyncResult {
        strategy: "git".to_string(),
        ok: true,
        message: "Git sync complete.".to_string(),
        changed_files,
    })
}

fn sync_mirror(repo_path: String, mirror_path: Option<String>) -> Result<SyncResult, String> {
    let source = PathBuf::from(&repo_path);
    let target = PathBuf::from(
        mirror_path.ok_or_else(|| "Mirror path required for mirror sync.".to_string())?,
    );

    if !source.exists() {
        return Err(format!("Path not found: {}", repo_path));
    }

    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let mut copied = 0usize;
    copy_markdown_tree(&source, &source, &target, &mut copied)?;

    Ok(SyncResult {
        strategy: "mirror".to_string(),
        ok: true,
        message: format!("Mirror sync complete: {} files copied.", copied),
        changed_files: copied,
    })
}

fn copy_markdown_tree(
    root: &Path,
    current: &Path,
    target_root: &Path,
    copied: &mut usize,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            copy_markdown_tree(root, &path, target_root, copied)?;
            continue;
        }

        if !is_markdown_like(&path) {
            continue;
        }

        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let target = target_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&path, &target).map_err(|e| e.to_string())?;
        *copied += 1;
    }

    Ok(())
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".hg" | ".svn" | "node_modules" | "target" | "dist" | "dist-ssr"
    )
}

fn is_markdown_like(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt"))
        .unwrap_or(false)
}

fn format_status(status: Status) -> String {
    let mut parts = Vec::new();

    if status.contains(Status::INDEX_NEW) {
        parts.push("new");
    }
    if status.contains(Status::INDEX_MODIFIED) {
        parts.push("modified");
    }
    if status.contains(Status::INDEX_DELETED) {
        parts.push("deleted");
    }
    if status.contains(Status::INDEX_RENAMED) {
        parts.push("renamed");
    }
    if status.contains(Status::INDEX_TYPECHANGE) {
        parts.push("typechange");
    }
    if status.contains(Status::WT_NEW) {
        parts.push("untracked");
    }
    if status.contains(Status::WT_MODIFIED) {
        parts.push("modified");
    }
    if status.contains(Status::WT_DELETED) {
        parts.push("deleted");
    }
    if status.contains(Status::WT_RENAMED) {
        parts.push("renamed");
    }
    if status.contains(Status::WT_TYPECHANGE) {
        parts.push("typechange");
    }
    if status.contains(Status::CONFLICTED) {
        parts.push("conflicted");
    }

    if parts.is_empty() {
        "unchanged".to_string()
    } else {
        parts.join(", ")
    }
}

fn repo_has_changes(repo: &Repository) -> Result<bool, String> {
    let statuses = repo.statuses(None).map_err(|e| e.to_string())?;
    Ok(statuses.iter().any(|s| {
        let st = s.status();
        !st.is_empty() && !st.contains(Status::IGNORED)
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            git_is_repo,
            git_init,
            git_current_branch,
            git_status,
            git_add_all,
            git_add_file,
            git_commit,
            git_pull,
            git_force_pull,
            git_push,
            git_log,
            git_remote,
            git_check_conflicts,
            git_abort_merge,
            git_add_remote,
            sync_strategies,
            sync_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
