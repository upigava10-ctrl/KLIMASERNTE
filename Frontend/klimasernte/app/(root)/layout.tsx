import { Footer } from "@/components/footer/Footer";
import { Navbar } from "@/components/navbar/Navbar";
import { ReactNode } from "react";

const RootLayout = ({ children }: Readonly<{children: ReactNode}>) => {

  return (
    <main className="relative bg-white">
        <Navbar/>
            <div className="flex">
                <div className="w-full">{children}</div>
            </div>
        <Footer/>
    </main>
  );
};

export default RootLayout;
