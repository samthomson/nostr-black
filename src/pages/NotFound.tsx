import { useSeoMeta } from "@unhead/react";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useSeoMeta({
    title: "404 - Page Not Found",
    description: "The page you are looking for could not be found. Return to the home page to continue browsing.",
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
      <div>
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="text-muted-foreground mb-4 text-xl">page not found</p>
        <a href="/" className="text-primary underline underline-offset-4">
          return home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
