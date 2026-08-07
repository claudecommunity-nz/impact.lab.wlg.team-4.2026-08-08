import { redirect } from "next/navigation";

/** Nothing lives at the root — send visitors to the app. */
export default function Home() {
  redirect("/notes");
}
