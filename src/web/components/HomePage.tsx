/** @jsxImportSource react */
import { useState, useEffect } from 'react';
import { Sidebar, SidebarProps } from './Sidebar';
import { Modal } from './Modal';
import { FileExplorer } from './FileExplorer';
import '../assets/css/global.css'
import '../assets/css/HomePage.css'

interface RecentProject {
    path: string;
    lastOpened: number;
}

interface HomePageProps {
    onStartChat: (message: string) => void;
    onOpenProject: (path: string) => void;
    sidebarProps: SidebarProps;
}

function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    return `${days} day${days !== 1 ? 's' : ''} ago`;
}

export function HomePage({ onStartChat, onOpenProject, sidebarProps }: HomePageProps) {
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showFileExplorer, setShowFileExplorer] = useState(false);

    useEffect(() => {
        async function fetchRecentProjects() {
            try {
                const response = await fetch('/api/recent-projects');
                if (response.ok) {
                    const projects = await response.json();
                    setRecentProjects(projects.slice(0, 3));
                }
            } catch (error) {
                console.error('Failed to fetch recent projects:', error);
            } finally {
                setIsLoading(false);
            }
        }
        fetchRecentProjects();

        const interval = setInterval(fetchRecentProjects, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleProjectClick = async (path: string) => {
        onOpenProject(path);
    };
    return (
        <div className="home-page">
            <Sidebar {...sidebarProps} />

            <div className="main-content">
                <div className="branding">
                    <picture className="logo-container">
                        <source srcSet="/logo_black.svg" media="(prefers-color-scheme: light)" />
                        <img src="/logo_white.svg" alt="Mosaic Logo" className="logo-img" />
                    </picture>
                </div>

                <div className="projects-section">
                    <div className="section-header">
                        <h2>Recents projects</h2>
                        <button className="open-project-btn" onClick={() => setShowFileExplorer(true)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                            Open project
                        </button>
                    </div>

                    <div className="project-list">
                        {isLoading ? (
                            <div className="project-item">
                                <span className="project-path">Loading...</span>
                            </div>
                        ) : recentProjects.length === 0 ? (
                            <div className="project-item">
                                <span className="project-path" style={{ color: 'var(--text-secondary)' }}>No recent projects</span>
                            </div>
                        ) : (
                            recentProjects.map((proj, i) => (
                                <div key={i} className="project-item" onClick={() => handleProjectClick(proj.path)}>
                                    <span className="project-path">{proj.path}</span>
                                    <span className="project-time">{formatRelativeTime(proj.lastOpened)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>


            <Modal
                isOpen={showFileExplorer}
                onClose={() => setShowFileExplorer(false)}
                title="Open project"
                className="file-explorer-modal"
            >
                <FileExplorer
                    onSelect={(path) => {
                        setShowFileExplorer(false);
                        onOpenProject(path);
                    }}
                    onCancel={() => setShowFileExplorer(false)}
                />
            </Modal>
        </div>
    );
}