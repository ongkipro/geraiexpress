import { WorkspaceFrame } from "@/components/workspace-frame";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
