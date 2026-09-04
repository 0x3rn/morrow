import "./dashboard.css";

export default function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  return <div className="morrow-dashboard">{children}</div>;
}
