"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PhoneOutgoing,
  Activity,
  Users,
  Settings,
  Database,
  Moon,
  Sun,
  DollarSign,
  Wallet,
  Bot,
  GitBranch,
  Key,
  PhoneIncoming,
  Sparkles,
  Menu,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAppContext } from "./app-provider";
import { motion, AnimatePresence } from "framer-motion";
import ProfileMenu from "@/components/ProfileMenu";
import { flushSync } from "react-dom";

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { currency, setCurrency, isSidebarCollapsed: isCollapsed, setIsSidebarCollapsed: setIsCollapsed } = useAppContext();
  const [mounted, setMounted] = React.useState(false);
  const [logoHover, setLogoHover] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const toggleThemeFn = (newTheme: string) => {
    if (!document.startViewTransition) {
      setTheme(newTheme);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => setTheme(newTheme));
    });
  };

  const routes = [
    { name: "Overview", path: "/", icon: LayoutDashboard },
    { name: "Outbound Dialer", path: "/dialer", icon: PhoneOutgoing },
    { name: "Call Logs", path: "/logs", icon: Activity },
    { name: "Leads / CRM", path: "/leads", icon: Users },
    { name: "Workflows", path: "/workflows", icon: GitBranch },
    { name: "Integrations", path: "/integrations", icon: Key },
    { name: "Wallet", path: "/wallet", icon: Wallet },
  ];

  const configRoutes = [
    { name: "Inbound Agent", path: "/config/inbound", icon: PhoneIncoming },
    { name: "Outbound Agent", path: "/config/outbound", icon: Bot },
  ];

  const currentTheme = mounted ? resolvedTheme : "light";

  const navItemVariants = {
    initial: { opacity: 0, x: -12 },
    animate: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: i * 0.04,
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1] as const,
      },
    }),
  };

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1, width: isCollapsed ? 80 : 260 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className="h-full bg-[#0a0a0a] border-r border-white/5 flex flex-col hidden md:flex relative overflow-hidden shrink-0 text-white z-20"
    >
      {/* Ambient glow behind logo */}
      <div className="absolute top-0 left-0 w-40 h-40 bg-indigo-500/10 dark:bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Logo & Toggle */}
      <div className={`p-5 flex relative z-10 transition-all ${isCollapsed ? 'flex-col items-center gap-6 mt-2' : 'items-center justify-between'}`}>
        <motion.div 
          className="flex items-center gap-3 cursor-pointer"
          onHoverStart={() => setLogoHover(true)}
          onHoverEnd={() => setLogoHover(false)}
        >
          <motion.div
            whileHover={{ scale: 1.08, rotate: 2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
            className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0"
          >
            <Sparkles className="w-4 h-4 text-white" />
          </motion.div>
          
          <AnimatePresence>
            {!isCollapsed && (
              <motion.div 
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="relative h-7 overflow-visible flex-1 flex items-center" 
                style={{ perspective: "1000px" }}
              >
                <motion.div
                  className="relative w-full h-full"
                  style={{ transformStyle: "preserve-3d" }}
                  animate={{ rotateX: logoHover ? -90 : 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  {/* Front Face: RapidX */}
                  <div 
                    className="absolute inset-0 flex items-center"
                    style={{ transform: "translateZ(14px)" }}
                  >
                    <span className="text-xl font-bold tracking-tight gradient-text">
                      RapidX
                    </span>
                  </div>
                  
                  {/* Bottom Face: AI-Calling-Agent */}
                  <div 
                    className="absolute inset-0 flex items-center"
                    style={{ transform: "rotateX(90deg) translateZ(14px)" }}
                  >
                    <span className="text-sm font-bold tracking-widest text-indigo-400 uppercase whitespace-nowrap">
                      AI-Calling-Agent
                    </span>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 space-y-0.5 mt-2 overflow-y-auto scrollbar-hide">
        {isCollapsed ? (
          <div className="h-4" />
        ) : (
          <div className="px-3 mb-3 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em] transition-opacity">
            Menu
          </div>
        )}
        {routes.map((route, i) => {
          const isActive =
            route.path === "/" ? pathname === "/" : pathname.startsWith(route.path);
          const Icon = route.icon;
          return (
            <motion.div
              key={route.path}
              custom={i}
              variants={navItemVariants}
              initial="initial"
              animate="animate"
            >
              <Link
                href={route.path}
                className={`group relative flex items-center ${isCollapsed ? 'justify-center' : 'gap-4 px-4'} py-3 rounded-xl transition-all duration-200 text-[13px] font-medium ${
                  isActive
                    ? "font-semibold shadow-sm"
                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                title={isCollapsed ? route.name : undefined}
              >
                {/* Active indicator pill */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-white rounded-xl shadow-md"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    />
                  )}
                </AnimatePresence>

                <Icon
                  className={`relative z-10 w-[18px] h-[18px] transition-colors duration-200 ${
                    isActive
                      ? "text-black"
                      : "text-gray-400 group-hover:text-white"
                  }`}
                />
                {!isCollapsed && (
                  <span className={`relative z-10 flex-1 flex items-center justify-between ${isActive ? 'text-black' : ''}`}>
                    {route.name}
                    {/* Add notification badge to Cards/Workflows to match design */}
                    {route.name === "Workflows" && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${isActive ? 'bg-black text-white' : 'bg-white/10 text-white'}`}>
                        13
                      </span>
                    )}
                  </span>
                )}

                {/* Hover highlight */}
                {!isActive && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/0 to-indigo-500/0 group-hover:from-indigo-500/[0.03] group-hover:to-transparent transition-all duration-300 pointer-events-none" />
                )}
              </Link>
            </motion.div>
          );
        })}

        {isCollapsed ? (
          <div className="h-6 mt-6 border-t border-gray-200/50 dark:border-white/5 mx-2" />
        ) : (
          <div className="px-3 mb-3 mt-6 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em]">
            Configuration
          </div>
        )}
        {configRoutes.map((route, i) => {
          const isActive = pathname.startsWith(route.path);
          const Icon = route.icon;
          return (
            <motion.div
              key={route.path}
              custom={i + routes.length}
              variants={navItemVariants}
              initial="initial"
              animate="animate"
            >
              <Link
                href={route.path}
                className={`group relative flex items-center ${isCollapsed ? 'justify-center' : 'gap-4 px-4'} py-3 rounded-xl transition-all duration-200 text-[13px] font-medium ${
                  isActive
                    ? "font-semibold shadow-sm"
                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                title={isCollapsed ? route.name : undefined}
              >
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="activeNavConfig"
                      className="absolute inset-0 bg-white rounded-xl shadow-md"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    />
                  )}
                </AnimatePresence>
                <Icon
                  className={`relative z-10 w-[18px] h-[18px] transition-colors duration-200 ${
                    isActive
                      ? "text-black"
                      : "text-gray-400 group-hover:text-white"
                  }`}
                />
                {!isCollapsed && <span className={`relative z-10 flex-1 ${isActive ? 'text-black' : ''}`}>{route.name}</span>}
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom controls */}
      <div className={`p-4 border-t border-gray-200/50 dark:border-white/5 space-y-1 ${isCollapsed ? 'px-2' : ''}`}>
        {/* Currency selector */}
        <div 
          className={`relative flex items-center ${isCollapsed ? 'justify-center' : 'gap-2 px-3'} py-2 text-[13px] font-medium text-gray-500 dark:text-gray-400 rounded-xl hover:bg-gray-100/80 dark:hover:bg-white/5 transition-all duration-200`}
          title={isCollapsed ? `Currency: ${currency}` : undefined}
        >
          <DollarSign className="w-[18px] h-[18px] text-gray-400 dark:text-gray-500 shrink-0" />
          {!isCollapsed && (
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as any)}
              className="bg-transparent outline-none flex-1 cursor-pointer text-gray-500 dark:text-gray-400 text-[13px]"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          )}
          {isCollapsed && (
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as any)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          )}
        </div>

        {/* Segmented Theme Toggle */}
        {!isCollapsed && (
          <div className="px-3 pt-4 pb-2">
            <div className="text-[11px] font-semibold text-gray-500 mb-3">Theme</div>
            <div className="flex bg-[#0A0A0A] rounded-xl p-1 relative border border-white/5">
              <button
                onClick={() => {
                  if (currentTheme !== "dark") toggleThemeFn("dark");
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium z-10 transition-colors ${currentTheme === "dark" ? "text-black" : "text-gray-400 hover:text-white"}`}
              >
                <Moon className="w-3.5 h-3.5" /> Dark
              </button>
              <button
                onClick={() => {
                  if (currentTheme !== "light") toggleThemeFn("light");
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium z-10 transition-colors ${currentTheme === "light" ? "text-black" : "text-gray-400 hover:text-white"}`}
              >
                <Sun className="w-3.5 h-3.5" /> Light
              </button>

              {/* Sliding background */}
              <motion.div
                className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm"
                initial={false}
                animate={{ x: currentTheme === "dark" ? 0 : "100%" }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              />
            </div>
          </div>
        )}

        {/* Settings */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200 transition-all duration-200 w-full text-[13px] font-medium`}
          title={isCollapsed ? "Settings" : undefined}
        >
          <Settings className="w-[18px] h-[18px] shrink-0" />
          {!isCollapsed && "Settings"}
        </motion.button>

        {isCollapsed && (
          <div className="flex justify-center mt-2 w-full pt-2 border-t border-gray-100/50 dark:border-white/5">
            <ProfileMenu className="relative" />
          </div>
        )}
      </div>
    </motion.div>
  );
}
