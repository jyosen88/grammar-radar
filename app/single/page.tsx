import AnalyzeTool from "@/components/AnalyzeTool";
import { AuthGuard } from "@/components/AuthGuard";

export const metadata = {
  title: "Grammar Radar · 单题语法分析",
};

export default function SinglePage() {
  return (
    <AuthGuard>
      <AnalyzeTool variant="single" />
    </AuthGuard>
  );
}
