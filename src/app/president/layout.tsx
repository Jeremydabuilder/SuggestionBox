import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suggestion inbox",
  robots: { index: false, follow: false, nocache: true },
};

export default function PresidentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
