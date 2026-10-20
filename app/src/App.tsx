import { Box } from "@mantine/core";
import { useBackground } from "./hooks/useBackground";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { Decoder } from "./Decoder";

function App() {
  const background = useBackground();

  return (
    <Box style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
      <BackgroundLayer settings={background.settings} />
      <Box
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          minHeight: 0,
        }}
      >
        <Decoder background={background} />
      </Box>
    </Box>
  );
}

export default App;
