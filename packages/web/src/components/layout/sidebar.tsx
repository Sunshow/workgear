import { Link, useLocation } from 'react-router'
import { FolderKanban, Workflow, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserMenu } from './user-menu'

const navItems = [
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/explore', label: '探索', icon: Globe },
]

export function Sidebar() {
  const location = useLocation()

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Workflow className="h-5 w-5 text-primary" />
          <span>WorkGear</span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to)
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t p-3">
        <UserMenu />
      </div>
    </aside>
  )
}
