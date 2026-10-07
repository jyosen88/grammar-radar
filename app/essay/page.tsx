import AnalyzeTool from "@/components/AnalyzeTool";
import { AuthGuard } from "@/components/AuthGuard";

export const metadata = {
  title: "Grammar Radar · 作文分析",
};

export default function EssayPage() {
  return (
    <AuthGuard>
      <AnalyzeTool variant="essay" />
    </AuthGuard>
  );
}
