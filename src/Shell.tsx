import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { Icon, type IconName, useApi, useToast } from './ui';
import { useAuth } from './App';

interface NavEntry { to: string; label: string; icon: IconName; end?: boolean }
const WORKSPACE_NAV: NavEntry[] = [
  { to: '/app', label: 'Overview', icon: 'pulse', end: true },
  { to: '/app/leads', label: 'Lead inbox', icon: 'inbox' },
  { to: '/app/pipeline', label: 'Pipeline', icon: 'board' },
  { to: '/app/tasks', label: 'Follow-ups', icon: 'check' },
  { to: '/app/reports', label: 'Reports', icon: 'chart' },
];
const MANAGE_NAV: NavEntry[] = [
  { to: '/app/data', label: 'Import & export', icon: 'upload' },
  { to: '/app/team', label: 'Team', icon: 'users' },
  { to: '/app/settings', label: 'Settings', icon: 'settings' },
  { to: '/app/audit', label: 'Audit log', icon: 'shield' },
];

const TITLES: Record<string, string> = {
  '/app': 'Overview', '/app/leads': 'Lead inbox', '/app/pipeline': 'Pipeline',
  '/app/tasks': 'Follow-ups', '/app/reports': 'Reports', '/app/data': 'Import & export',
  '/app/team': 'Team', '/app/settings': 'Settings', '/app/audit': 'Audit log',
};

export function Shell() {
  const { auth, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: notifications } = useApi<{ unread: number }>('/notifications');

  const org = auth?.currentOrganization;
  const role = auth?.organizations.find((o) => o.id === org?.id)?.role || 'agent';
  const title = TITLES[location.pathname] || (location.pathname.startsWith('/app/leads/') ? 'Lead detail' : 'Workspace');

  const switchWorkspace = async (organizationId: string) => {
    try {
      await api('/auth/switch', { method: 'POST', body: { organizationId } });
      window.location.assign('/app');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not switch workspace', 'error');
    }
  };

  const onSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const renderNav = (entries: NavEntry[]) => entries.map((entry) => (
    <NavLink key={entry.to} to={entry.to} end={entry.end}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      onClick={() => setMenuOpen(false)}>
      <Icon name={entry.icon} size={17} />
      <span>{entry.label}</span>
      {entry.to === '/app/tasks' && notifications?.unread ? <span className="count">{notifications.unread}</span> : null}
    </NavLink>
  ));

  return (
    <div className="shell">
      {menuOpen && <div className="modal-backdrop" style={{ zIndex: 35 }} onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Icon name="pulse" size={19} /></div>
          <div>
            <div className="brand-name">LeadPulse</div>
            <div className="brand-sub">Speed to lead</div>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="nav-label">Workspace</div>
          {renderNav(WORKSPACE_NAV)}
          <div className="nav-label">Manage</div>
          {renderNav(MANAGE_NAV)}
        </nav>
        <div className="sidebar-foot">
          <div className="workspace-chip">
            <Icon name="board" size={16} />
            <div style={{ minWidth: 0 }}>
              <strong>{org?.name || 'No workspace'}</strong>
              <span>{role.replace('workspace_', '').replace('_', ' ')}</span>
            </div>
          </div>
          {auth && auth.organizations.length > 1 && (
            <select className="select" style={{ marginTop: 8, minHeight: 32, fontSize: 12 }}
              value={org?.id || ''} onChange={(e) => void switchWorkspace(e.target.value)}
              aria-label="Switch workspace">
              {auth.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <div className="side-user">
            <div className="avatar">{auth?.user.name?.slice(0, 1).toUpperCase() || '?'}</div>
            <span className="side-user-name">{auth?.user.name}</span>
            <button type="button" className="icon-btn" onClick={() => void onSignOut()} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn mobile-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation">
            <Icon name="menu" size={20} />
          </button>
          <h2>{title}</h2>
          <span className="topbar-sub">{org?.timezone || 'UTC'}</span>
          <div className="topbar-actions">
            <NavLink to="/app/tasks" className="btn btn-small">
              <Icon name="clock" size={15} /> Follow-ups
              {notifications?.unread ? <span className="badge badge-amber">{notifications.unread}</span> : null}
            </NavLink>
          </div>
        </header>
        {org?.is_demo ? (
          <div className="demo-banner">
            <Icon name="alert" size={15} />
            <span><strong>Demo workspace — synthetic data only.</strong> Names, emails and phone numbers are examples. Do not enter real customer data here.</span>
          </div>
        ) : null}
        <main><Outlet /></main>
      </div>
    </div>
  );
}
