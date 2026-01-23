/** @jsxImportSource react */
import { useState, useEffect } from 'react';
import '../assets/css/FileExplorer.css';

interface FileInfo {
    name: string;
    isDirectory: boolean;
    path: string;
}

interface FileExplorerProps {
    onSelect: (path: string) => void;
    onCancel: () => void;
    initialPath?: string;
}

export function FileExplorer({ onSelect, onCancel, initialPath }: FileExplorerProps) {
    const [currentPath, setCurrentPath] = useState<string>(initialPath || '');
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!currentPath) {
            fetch('/api/workspace')
                .then(res => res.json())
                .then(data => setCurrentPath(data.workspace))
                .catch(() => { });
        }
    }, [initialPath]);

    useEffect(() => {
        if (!currentPath) return;

        async function fetchFiles() {
            setIsLoading(true);
            try {
                const encodedPath = encodeURIComponent(currentPath);
                const response = await fetch(`/api/files?path=${encodedPath}`);
                if (response.ok) {
                    const data = await response.json();
                    setFiles(data.files);
                    if (data.path) setCurrentPath(data.path);
                }
            } catch (error) {
                console.error("Failed to load files", error);
            } finally {
                setIsLoading(false);
            }
        }

        fetchFiles();
        fetchFiles();
    }, [currentPath]);

    useEffect(() => {
        setSelectedFile(null);
    }, [currentPath]);

    const handleNavigate = (path: string) => {
        setCurrentPath(path);
    };

    const handleFileClick = (file: FileInfo) => {
        setSelectedFile(file);
    };

    const handleFileDoubleClick = (file: FileInfo) => {
        if (file.isDirectory) {
            handleNavigate(file.path);
        }
    };

    const handleConfirm = () => {
        if (selectedFile && selectedFile.isDirectory) {
            onSelect(selectedFile.path);
        } else {
            onSelect(currentPath);
        }
    };

    const handleUp = () => {
        const separator = currentPath.includes('\\') ? '\\' : '/';
        let cleanPath = currentPath;
        if (cleanPath.endsWith(separator) && cleanPath.length > 1) {
            cleanPath = cleanPath.slice(0, -1);
        }

        const lastIndex = cleanPath.lastIndexOf(separator);
        if (lastIndex > 0) {
            setCurrentPath(cleanPath.substring(0, lastIndex));
        } else if (lastIndex === 0) {
            setCurrentPath(separator);
        } else if (lastIndex === -1 && separator === '\\' && cleanPath.length > 2) {
            // C: case? simplified
        }
    };

    const FolderIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="file-icon">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
    );

    const FileIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="file-icon">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
        </svg>
    );

    const UpIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
    );

    return (
        <div className="file-explorer-container">
            <div className="file-explorer-header">
                <button className="explorer-btn cancel" onClick={handleUp} title="Go Up">
                    <UpIcon />
                </button>
                <div className="file-explorer-path" title={currentPath}>
                    {currentPath}
                </div>
            </div>

            <div className="file-list">
                {isLoading ? (
                    <div className="loading-indicator">Loading...</div>
                ) : files.length === 0 ? (
                    <div className="empty-message">Empty directory</div>
                ) : (
                    files.map((file, i) => (
                        <div
                            key={i}
                            className={`file-item ${file.isDirectory ? 'is-directory' : ''} ${selectedFile?.path === file.path ? 'selected' : ''}`}
                            onClick={() => handleFileClick(file)}
                            onDoubleClick={() => handleFileDoubleClick(file)}
                        >
                            {file.isDirectory ? <FolderIcon /> : <FileIcon />}
                            <span className="file-name">{file.name}</span>
                        </div>
                    ))
                )}
            </div>

            <div className="file-explorer-footer">
                <div className="selected-path-display">
                    {selectedFile ? selectedFile.name : ''}
                </div>
                <div className="footer-actions">
                    <button className="explorer-btn cancel" onClick={onCancel}>Cancel</button>
                    <button className="explorer-btn confirm" onClick={handleConfirm}>
                        {selectedFile?.isDirectory ? 'Open Selected' : 'Open Current Folder'}
                    </button>
                </div>
            </div>
        </div>
    );
}