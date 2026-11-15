"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("@/components/dashboard/Dashboard"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
      Cargando mapa...
    </div>
  ),
});

export default function MapaWrapper() {
  return <Dashboard />;
}