import { SiteNav } from "@/components/SiteNav";
import { AuthGuard } from "@/components/AuthGuard";
import { SentenceTool } from "@/components/SentenceTool";

export const metadata = {
  title: "Grammar Radar · 长难句分析",
};

/** 长难句分析：分步引导模式 */
export default function SentencePage() {
  return (
    <AuthGuard>
      <SentenceTool />
    </AuthGuard>
  );
}
