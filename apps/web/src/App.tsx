import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">BookerDoc</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Váš další termín u lékaře.</h1>
        <p className="text-muted-foreground">Vyberte si službu a čas, který vám vyhovuje.</p>
      </header>
      <Card>
        <CardHeader>
          <Badge variant="secondary">Připravujeme</Badge>
          <CardTitle><h2>Online objednání</h2></CardTitle>
          <CardDescription>Rezervace zatím nejsou dostupné.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Připravujeme výběr dostupných termínů podle pracovní doby vašeho lékaře
            a délky zvolené služby. Potvrzení rezervace vám přijde e-mailem.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
