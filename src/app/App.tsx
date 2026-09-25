import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from './store';
import Home from '../ui/screens/Home';
import Player from '../ui/screens/Player';
import Result from '../ui/screens/Result';
import Mock, { MockResult, MockStart } from '../ui/screens/Mock';
import Practice, { ScopePicker, Search } from '../ui/screens/Practice';
import Analysis from '../ui/screens/Analysis';
import SettingsScreen from '../ui/screens/Settings';
import AdminList, { AdminEdit, AdminImport } from '../ui/screens/Admin';
import Dev from '../ui/screens/Dev';
import { Icon } from '../ui/components';

const TABS = [
  { to: '/', label: 'ホーム', icon: 'home' },
  { to: '/practice', label: '演習', icon: 'practice' },
  { to: '/analysis', label: '分析', icon: 'chart' },
  { to: '/settings', label: '設定', icon: 'gear' },
];

/** 問題画面・模試では下部タブを消して集中させる */
function TabBar() {
  const { pathname } = useLocation();
  if (/^\/(play|mock|result|mock-result)(\/|$)/.test(pathname) || pathname.startsWith('/admin')) return null;
  return <nav className="tabbar" aria-label="メイン">
    {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
      <Icon name={t.icon} /><span>{t.label}</span>
    </NavLink>)}
  </nav>;
}

export default function App() {
  return <AppProvider>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/practice/subject/:nodeId" element={<ScopePicker />} />
        <Route path="/search" element={<Search />} />
        <Route path="/play/:id" element={<Player />} />
        <Route path="/result/:id" element={<Result />} />
        <Route path="/mock" element={<MockStart />} />
        <Route path="/mock/:id" element={<Mock />} />
        <Route path="/mock-result/:id" element={<MockResult />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/admin" element={<AdminList />} />
        <Route path="/admin/new" element={<AdminEdit />} />
        <Route path="/admin/q/:id" element={<AdminEdit />} />
        <Route path="/admin/import" element={<AdminImport />} />
        <Route path="/dev" element={<Dev />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <TabBar />
    </HashRouter>
  </AppProvider>;
}
