function SplashScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-black text-white">
      <div className="relative flex flex-col items-center">
        <div className="absolute h-52 w-52 rounded-full bg-white/5 blur-3xl" />

        <div className="relative flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
          <img
            src="/icons/nofvce-icon.png"
            alt="NoFvce Crew"
            className="h-16 w-16 object-contain opacity-90"
          />
        </div>

        <p className="mt-8 text-xs uppercase tracking-[0.6em] text-white/40">
          {/* NOFVCE CREW */}
        </p>
      </div>
    </main>
  )
}

export default SplashScreen
